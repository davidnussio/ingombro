import { Context, Effect, FileSystem, Layer, Option, Schema, Semaphore } from "effect";
import { AppPaths } from "./paths";
import { Settings } from "./settings";
import {
	CacheData,
	LegacyCacheData,
	type CacheEntry,
	type CacheListItem,
	type CleanableResult,
	type DirEntry,
} from "./types";

// ─── Pure tree / store helpers ──────────────────────────────────────────────

export function findCacheEntry(store: CacheData, rootPath: string): CacheEntry | undefined {
	return store.entries.find((e) => e.rootPath === rootPath);
}

/** Most recent first, one entry per rootPath. */
export function listCacheEntries(store: CacheData): CacheListItem[] {
	const seen = new Set<string>();
	const out: CacheListItem[] = [];
	for (const e of store.entries) {
		if (seen.has(e.rootPath)) continue;
		seen.add(e.rootPath);
		out.push({ rootPath: e.rootPath, timestamp: e.timestamp, size: e.tree?.size ?? 0 });
	}
	return out;
}

export function findNode(tree: DirEntry, path: string): DirEntry | undefined {
	if (tree.path === path) return tree;
	if (!tree.children || !path.startsWith(tree.path)) return undefined;
	for (const child of tree.children) {
		const found = findNode(child, path);
		if (found) return found;
	}
	return undefined;
}

/** Children of `dirPath` from whichever cached tree contains it. */
export function findChildrenInStore(store: CacheData, dirPath: string): ReadonlyArray<DirEntry> {
	for (const cacheEntry of store.entries) {
		if (dirPath.startsWith(cacheEntry.rootPath)) {
			const found = findNode(cacheEntry.tree, dirPath);
			if (found) return found.children ?? [];
		}
	}
	return [];
}

/**
 * Remove `targetPath` from a tree, propagating the size change upwards.
 * Returns the new tree (only the branch leading to the target is copied), or undefined if not found.
 */
export function removeFromTree(tree: DirEntry, targetPath: string): DirEntry | undefined {
	if (!tree.children) return undefined;
	const idx = tree.children.findIndex((c) => c.path === targetPath);
	if (idx !== -1) {
		const removed = tree.children[idx]!;
		return { ...tree, size: tree.size - removed.size, children: tree.children.toSpliced(idx, 1) };
	}
	for (const [i, child] of tree.children.entries()) {
		const updated = removeFromTree(child, targetPath);
		if (updated) {
			return {
				...tree,
				size: tree.size - (child.size - updated.size),
				children: tree.children.with(i, updated),
			};
		}
	}
	return undefined;
}

/** Drop `targetPath` (and anything below it) from a cache entry's tree and cleanables. Undefined if nothing changed. */
export function removeDirFromCacheEntry(cacheEntry: CacheEntry, targetPath: string): CacheEntry | undefined {
	const tree = removeFromTree(cacheEntry.tree, targetPath);
	let cleanables = cacheEntry.cleanables;
	if (cleanables) {
		const items = cleanables.items.filter((i) => i.path !== targetPath && !i.path.startsWith(targetPath + "/"));
		if (items.length !== cleanables.items.length) {
			cleanables = { items, totalSize: items.reduce((s, i) => s + i.size, 0) };
		}
	}
	if (!tree && cleanables === cacheEntry.cleanables) return undefined;
	return { ...cacheEntry, tree: tree ?? cacheEntry.tree, cleanables };
}

/** Put `entry` first, replacing any previous scan of the same root, keeping at most `max` entries. */
export function upsertEntry(store: CacheData, entry: CacheEntry, max: number): CacheData {
	return { entries: [entry, ...store.entries.filter((e) => e.rootPath !== entry.rootPath)].slice(0, max) };
}

// ─── Persistence ────────────────────────────────────────────────────────────

const CacheJson = Schema.fromJsonString(CacheData);
const LegacyCacheJson = Schema.fromJsonString(LegacyCacheData);

/**
 * The gzipped scan cache (~/.ingombro/cache.json.gz). Reads never fail (empty cache instead),
 * writes are logged on failure. Read-modify-write operations are serialized.
 */
export class CacheStore extends Context.Service<
	CacheStore,
	{
		readonly load: Effect.Effect<CacheData>;
		save(data: CacheData): Effect.Effect<void>;
		/** Atomically transform the stored cache; `f` returns undefined to leave it untouched. */
		update(f: (data: CacheData) => CacheData | undefined): Effect.Effect<void>;
		findEntry(rootPath: string): Effect.Effect<Option.Option<CacheEntry>>;
		/** Store a fresh scan (most recent first, capped by settings.maxCacheEntries). */
		upsert(entry: CacheEntry): Effect.Effect<void>;
		remove(rootPath: string): Effect.Effect<void>;
		trim(maxEntries: number): Effect.Effect<void>;
		/** Attach Smart Clean results to a cached scan. False if the scan is not cached. */
		setCleanables(rootPath: string, cleanables: CleanableResult): Effect.Effect<boolean>;
		/** Prune deleted paths from every cached tree. */
		pruneDeleted(paths: ReadonlyArray<string>): Effect.Effect<void>;
	}
>()("ingombro/core/CacheStore") {
	static readonly layer = Layer.effect(
		CacheStore,
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const paths = yield* AppPaths;
			const settings = yield* Settings;
			const lock = yield* Semaphore.make(1);

			const decodeText = (text: string) =>
				Schema.decodeUnknownEffect(CacheJson)(text).pipe(
					Effect.catch(() =>
						Schema.decodeUnknownEffect(LegacyCacheJson)(text).pipe(
							Effect.map((legacy): CacheData => ({ entries: [legacy] })),
						),
					),
				);

			// One-time migration from legacy cache locations
			yield* Effect.gen(function* () {
				if (yield* fs.exists(paths.cacheFile)) return;
				for (const legacy of paths.legacyCacheFiles) {
					if (!(yield* fs.exists(legacy))) continue;
					yield* paths.ensureAppDir;
					const text = yield* fs.readFileString(legacy);
					yield* fs.writeFile(paths.cacheFile, Bun.gzipSync(new TextEncoder().encode(text)));
					yield* fs.remove(legacy, { force: true });
					return;
				}
			}).pipe(Effect.ignore);

			const load = Effect.gen(function* () {
				const bytes = yield* fs.readFile(paths.cacheFile);
				const text = yield* Effect.try(() => new TextDecoder().decode(Bun.gunzipSync(new Uint8Array(bytes)))).pipe(
					// Fallback: plain JSON (pre-compression)
					Effect.orElseSucceed(() => new TextDecoder().decode(bytes)),
				);
				return yield* decodeText(text);
			}).pipe(
				Effect.orElseSucceed((): CacheData => ({ entries: [] })),
				Effect.withSpan("CacheStore.load"),
			);

			const save = Effect.fn("CacheStore.save")(
				function* (data: CacheData) {
					yield* paths.ensureAppDir;
					const json = yield* Schema.encodeEffect(CacheJson)(data);
					yield* Effect.logDebug(`[cache] Saving cache (hash=${Bun.hash(json).toString(16)}, entries=${data.entries.length})`);
					yield* fs.writeFile(paths.cacheFile, Bun.gzipSync(new TextEncoder().encode(json)));
				},
				Effect.catch((e) => Effect.logError("[ingombro] Failed to save cache:", e)),
			);

			const update = (f: (data: CacheData) => CacheData | undefined) =>
				Effect.gen(function* () {
					const next = f(yield* load);
					if (next) yield* save(next);
				}).pipe(Semaphore.withPermit(lock));

			const findEntry = (rootPath: string) =>
				load.pipe(Effect.map((store) => Option.fromNullishOr(findCacheEntry(store, rootPath))));

			const upsert = Effect.fn("CacheStore.upsert")(function* (entry: CacheEntry) {
				const { maxCacheEntries } = yield* settings.get;
				yield* update((store) => upsertEntry(store, entry, maxCacheEntries));
			});

			const remove = (rootPath: string) =>
				update((store) => ({ entries: store.entries.filter((e) => e.rootPath !== rootPath) }));

			const trim = (maxEntries: number) =>
				update((store) => (store.entries.length > maxEntries ? { entries: store.entries.slice(0, maxEntries) } : undefined));

			const setCleanables = Effect.fn("CacheStore.setCleanables")(function* (rootPath: string, cleanables: CleanableResult) {
				let found = false;
				yield* update((store) => {
					const idx = store.entries.findIndex((e) => e.rootPath === rootPath);
					if (idx === -1) return undefined;
					found = true;
					return { entries: store.entries.with(idx, { ...store.entries[idx]!, cleanables }) };
				});
				return found;
			});

			const pruneDeleted = (deleted: ReadonlyArray<string>) =>
				update((store) => {
					let changed = false;
					const entries = store.entries.map((entry) => {
						let current = entry;
						for (const p of deleted) current = removeDirFromCacheEntry(current, p) ?? current;
						if (current !== entry) changed = true;
						return current;
					});
					return changed ? { entries } : undefined;
				});

			return CacheStore.of({ load, save, update, findEntry, upsert, remove, trim, setCleanables, pruneDeleted });
		}),
	);
}
