import { rmSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { APP_DIR, ensureAppDir } from "./paths";
import { loadSettings } from "./settings";
import { logger } from "./log";
import type { CacheData, CacheEntry, DirEntry } from "./types";

const CACHE_FILE = join(APP_DIR, "cache.json.gz");
const OLD_CACHE_FILE = join(homedir(), ".diskscanner_cache.json");
const OLD_CACHE_FILE_UNGZ = join(APP_DIR, "cache.json");

let migrated = false;

/** One-time migration from legacy cache locations. */
async function migrateLegacyCache() {
	if (migrated) return;
	migrated = true;
	try {
		if (await Bun.file(CACHE_FILE).exists()) return;
		ensureAppDir();
		for (const legacy of [OLD_CACHE_FILE, OLD_CACHE_FILE_UNGZ]) {
			if (await Bun.file(legacy).exists()) {
				const oldData = await Bun.file(legacy).text();
				await Bun.write(CACHE_FILE, Bun.gzipSync(new TextEncoder().encode(oldData)));
				rmSync(legacy, { force: true });
				return;
			}
		}
	} catch {}
}

function normalize(parsed: any): CacheData {
	// Migrate old single-entry format
	if (parsed && !parsed.entries && parsed.rootPath) {
		return { entries: [{ timestamp: parsed.timestamp, rootPath: parsed.rootPath, tree: parsed.tree }] };
	}
	return parsed as CacheData;
}

export async function loadCacheStore(): Promise<CacheData> {
	await migrateLegacyCache();
	const cacheFile = Bun.file(CACHE_FILE);
	try {
		if (await cacheFile.exists()) {
			const raw = Bun.gunzipSync(new Uint8Array(await cacheFile.arrayBuffer()));
			return normalize(JSON.parse(new TextDecoder().decode(raw)));
		}
	} catch {
		// Fallback: plain JSON (pre-compression)
		try {
			if (await cacheFile.exists()) return normalize(await cacheFile.json());
		} catch {}
	}
	return { entries: [] };
}

export async function saveCacheStore(data: CacheData): Promise<void> {
	try {
		ensureAppDir();
		const json = JSON.stringify(data);
		logger.log(`[cache] Saving cache (hash=${Bun.hash(json).toString(16)}, entries=${data.entries.length})`);
		await Bun.write(CACHE_FILE, Bun.gzipSync(new TextEncoder().encode(json)));
	} catch (e) {
		logger.error("[ingombro] Failed to save cache:", e);
	}
}

export async function upsertCacheEntry(store: CacheData, entry: CacheEntry): Promise<CacheData> {
	const settings = await loadSettings();
	const filtered = store.entries.filter((e) => e.rootPath !== entry.rootPath);
	filtered.unshift(entry);
	return { entries: filtered.slice(0, settings.maxCacheEntries) };
}

export function findCacheEntry(store: CacheData, rootPath: string): CacheEntry | null {
	return store.entries.find((e) => e.rootPath === rootPath) || null;
}

/** Most recent first, one entry per rootPath. */
export function listCacheEntries(store: CacheData): { rootPath: string; timestamp: number; size: number }[] {
	const seen = new Set<string>();
	const out: { rootPath: string; timestamp: number; size: number }[] = [];
	for (const e of store.entries) {
		if (seen.has(e.rootPath)) continue;
		seen.add(e.rootPath);
		out.push({ rootPath: e.rootPath, timestamp: e.timestamp, size: e.tree?.size ?? 0 });
	}
	return out;
}

export async function deleteCacheEntry(rootPath: string) {
	const store = await loadCacheStore();
	store.entries = store.entries.filter((e) => e.rootPath !== rootPath);
	await saveCacheStore(store);
}

export function findNode(tree: DirEntry, path: string): DirEntry | null {
	if (tree.path === path) return tree;
	if (!tree.children || !path.startsWith(tree.path)) return null;
	for (const child of tree.children) {
		const found = findNode(child, path);
		if (found) return found;
	}
	return null;
}

/** Children of `dirPath` from whichever cached tree contains it. */
export function findChildrenInStore(store: CacheData, dirPath: string): DirEntry[] {
	for (const cacheEntry of store.entries) {
		if (dirPath.startsWith(cacheEntry.rootPath)) {
			const found = findNode(cacheEntry.tree, dirPath);
			if (found) return found.children || [];
		}
	}
	return [];
}

/** Remove `targetPath` from a cached tree, propagating the size change upwards. */
export function removeFromTree(tree: DirEntry, targetPath: string): boolean {
	function removeFromEntry(entry: DirEntry): number {
		if (!entry.children) return 0;
		const idx = entry.children.findIndex((c) => c.path === targetPath);
		if (idx !== -1) {
			const removed = entry.children[idx]!;
			entry.children.splice(idx, 1);
			entry.size -= removed.size;
			return removed.size;
		}
		for (const child of entry.children) {
			const removedSize = removeFromEntry(child);
			if (removedSize > 0) {
				entry.size -= removedSize;
				return removedSize;
			}
		}
		return 0;
	}
	return removeFromEntry(tree) > 0;
}

export function removeDirFromCacheEntry(cacheEntry: CacheEntry, targetPath: string): boolean {
	const removed = removeFromTree(cacheEntry.tree, targetPath);
	if (cacheEntry.cleanables) {
		const before = cacheEntry.cleanables.items.length;
		cacheEntry.cleanables.items = cacheEntry.cleanables.items.filter(
			(i) => i.path !== targetPath && !i.path.startsWith(targetPath + "/"),
		);
		if (cacheEntry.cleanables.items.length !== before) {
			cacheEntry.cleanables.totalSize = cacheEntry.cleanables.items.reduce((s, i) => s + i.size, 0);
		}
	}
	return removed;
}
