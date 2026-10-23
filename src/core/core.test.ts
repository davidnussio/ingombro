import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Effect, Exit, Fiber, Layer, Option } from "effect";
import {
	AppPaths,
	CacheStore,
	Cleanables,
	EntryInfoReader,
	FileActions,
	Scanner,
	Settings,
	SilentLogger,
	Stats,
	findNode,
	makeCoreLayer,
	parseEnvFile,
	removeDirFromCacheEntry,
	removeFromTree,
	type CacheEntry,
	type CoreServices,
	type DirEntry,
} from ".";

const root = mkdtempSync(join(tmpdir(), "ingombro-test-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const appDir = join(root, "app");
const TestLayer = makeCoreLayer(AppPaths.layerAt(appDir)).pipe(Layer.provideMerge(SilentLogger));
const run = <A, E>(effect: Effect.Effect<A, E, CoreServices>) => Effect.runPromise(Effect.provide(effect, TestLayer));

function makeTree(base: string) {
	mkdirSync(join(base, "proj/node_modules/pkg"), { recursive: true });
	writeFileSync(join(base, "proj/package.json"), "{}");
	writeFileSync(join(base, "proj/node_modules/pkg/index.js"), "x".repeat(10_000));
	writeFileSync(join(base, "proj/.env"), "API_KEY=secret\n");
	mkdirSync(join(base, "docs/sub"), { recursive: true });
	writeFileSync(join(base, "docs/readme.md"), "# hello\n");
	writeFileSync(join(base, "docs/sub/big.bin"), "y".repeat(50_000));
	mkdirSync(join(base, "constructor"), { recursive: true });
	writeFileSync(join(base, "toString"), "not a rule");
}

describe("pure helpers", () => {
	const tree: DirEntry = {
		path: "/r",
		name: "r",
		size: 30,
		isDir: true,
		children: [
			{ path: "/r/a", name: "a", size: 20, isDir: true, children: [{ path: "/r/a/x", name: "x", size: 20, isDir: false }] },
			{ path: "/r/b", name: "b", size: 10, isDir: false },
		],
	};

	test("removeFromTree propagates sizes without mutating", () => {
		const updated = removeFromTree(tree, "/r/a/x")!;
		expect(updated.size).toBe(10);
		expect(findNode(updated, "/r/a")!.size).toBe(0);
		expect(tree.size).toBe(30);
		expect(removeFromTree(tree, "/nope")).toBeUndefined();
	});

	test("removeDirFromCacheEntry drops cleanables below the path", () => {
		const entry: CacheEntry = {
			timestamp: 1,
			rootPath: "/r",
			tree,
			cleanables: {
				items: [
					{ path: "/r/a/x", projectPath: "/r/a", projectType: "t", folderName: "x", size: 20, risk: "low", category: "dev" },
				],
				totalSize: 20,
			},
		};
		const updated = removeDirFromCacheEntry(entry, "/r/a")!;
		expect(updated.tree.size).toBe(10);
		expect(updated.cleanables!.items).toHaveLength(0);
		expect(updated.cleanables!.totalSize).toBe(0);
	});

	test("parseEnvFile", () => {
		expect(parseEnvFile(`# c\nA=1\nB="two"\n=bad\nC=\n`)).toEqual([
			["A", "1"],
			["B", "two"],
		]);
	});
});

describe("services", () => {
	const scanRoot = join(root, "scan");
	makeTree(scanRoot);

	test("settings default, save and reload", async () => {
		const settings = await run(
			Effect.gen(function* () {
				const s = yield* Settings;
				const before = yield* s.get;
				yield* s.save({ ...before, maxDepth: 3 });
				return [before, yield* s.get] as const;
			}),
		);
		expect(settings[0]).toEqual({ maxCacheEntries: 10, deleteMode: "trash", maxDepth: 10 });
		expect(settings[1].maxDepth).toBe(3);
	});

	test("partial settings.json falls back per key", async () => {
		writeFileSync(join(appDir, "settings.json"), JSON.stringify({ deleteMode: "permanent" }));
		const s = await run(Settings.use((s) => s.get));
		expect(s).toEqual({ maxCacheEntries: 10, deleteMode: "permanent", maxDepth: 10 });
	});

	test("scan builds a sorted tree; hidden folders and node_modules are summed, not explored", async () => {
		const { tree, progress } = await run(Scanner.use((s) => s.scan(scanRoot)));
		const sizes = tree.children!.map((c) => c.size);
		expect(sizes).toEqual(sizes.toSorted((a, b) => b - a));
		expect(tree.children!.map((c) => c.name).sort()).toEqual(["constructor", "docs", "proj", "toString"]);
		const nodeModules = findNode(tree, join(scanRoot, "proj/node_modules"))!;
		expect(nodeModules.isDir).toBe(true);
		expect(nodeModules.children).toBeUndefined();
		expect(nodeModules.size).toBe(await run(Scanner.use((s) => s.dirSize(join(scanRoot, "proj/node_modules")))));
		expect(findNode(tree, join(scanRoot, "proj/.env"))?.isDir).toBe(false);
		expect(tree.size).toBe(tree.children!.reduce((s, c) => s + c.size, 0));
		expect(progress.files).toBeGreaterThan(0);
	});

	test("scan is cancelled by interruption", async () => {
		const exit = await run(
			Effect.gen(function* () {
				const scanner = yield* Scanner;
				const fiber = yield* Effect.forkChild(
					scanner.scan(scanRoot, { onProgress: () => Effect.never, progressIntervalMs: 0 }),
				);
				yield* Effect.yieldNow;
				yield* Fiber.interrupt(fiber);
				return yield* Fiber.await(fiber);
			}),
		);
		expect(Exit.hasInterrupts(exit)).toBe(true);
	});

	test("a long scan keeps serving I/O (so a cancel request can arrive)", async () => {
		// Everything below maxDepth is only summed: one big subtree to walk
		const wide = join(root, "wide");
		for (let i = 0; i < 4000; i++) mkdirSync(join(wide, "deep", `d${i}`, "sub"), { recursive: true });
		const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
		try {
			let answeredAt = 0;
			const scan = run(Scanner.use((s) => s.scan(wide, { maxDepth: 0 })));
			await Bun.sleep(5);
			const request = fetch(server.url).then(() => (answeredAt = performance.now()));
			await scan;
			const scanDoneAt = performance.now();
			await request;
			expect(answeredAt).toBeLessThan(scanDoneAt);
		} finally {
			server.stop(true);
		}
	});

	test("cache upsert, cleanables and prune round-trip through gzip", async () => {
		const result = await run(
			Effect.gen(function* () {
				const scanner = yield* Scanner;
				const cache = yield* CacheStore;
				const cleanables = yield* Cleanables;
				const { tree } = yield* scanner.scan(scanRoot);
				yield* cache.upsert({ timestamp: Date.now(), rootPath: scanRoot, tree });
				const detected = yield* cleanables.detect(scanRoot);
				const stored = yield* cache.setCleanables(scanRoot, detected);
				yield* cache.pruneDeleted([join(scanRoot, "docs/sub")]);
				const entry = yield* cache.findEntry(scanRoot);
				return { detected, stored, entry };
			}),
		);
		const types = result.detected.items.map((i) => i.projectType).sort();
		expect(types).toEqual(["Node / Bun", "Secrets"]);
		expect(result.stored).toBe(true);
		const entry = Option.getOrThrow(result.entry);
		expect(entry.cleanables!.items).toHaveLength(2);
		expect(findNode(entry.tree, join(scanRoot, "docs/sub"))).toBeUndefined();
	});

	test("legacy single-entry cache format is still readable", async () => {
		const legacyDir = join(root, "legacy");
		mkdirSync(legacyDir, { recursive: true });
		const tree: DirEntry = { path: "/x", name: "x", size: 1, isDir: true, children: [] };
		writeFileSync(join(legacyDir, "cache.json"), JSON.stringify({ timestamp: 5, rootPath: "/x", tree }));
		const store = await Effect.runPromise(
			CacheStore.use((c) => c.load).pipe(
				Effect.provide(makeCoreLayer(AppPaths.layerAt(legacyDir)).pipe(Layer.provideMerge(SilentLogger))),
			),
		);
		expect(store.entries[0]?.rootPath).toBe("/x");
		expect(existsSync(join(legacyDir, "cache.json"))).toBe(false);
		expect(existsSync(join(legacyDir, "cache.json.gz"))).toBe(true);
	});

	test("entry info for a directory and a text file", async () => {
		const [dir, file, missing] = await run(
			Effect.gen(function* () {
				const reader = yield* EntryInfoReader;
				return [
					yield* reader.get(join(scanRoot, "docs")),
					yield* reader.get(join(scanRoot, "docs/readme.md")),
					yield* reader.get(join(scanRoot, "nope")).pipe(Effect.flip),
				] as const;
			}),
		);
		expect(dir.isDir).toBe(true);
		expect(dir.fileCount).toBe(1);
		expect(dir.dirCount).toBe(1);
		expect(dir.typeDistribution?.[0]?.label).toBe("documents");
		expect(file.previewType).toBe("text");
		expect(file.textPreview).toBe("# hello\n");
		expect(missing._tag).toBe("PathNotFound");
	});

	test("batchDelete (permanent) reports missing paths and records stats", async () => {
		const victim = join(scanRoot, "docs/sub");
		const result = await run(
			Effect.gen(function* () {
				const settings = yield* Settings;
				yield* settings.save({ maxCacheEntries: 10, deleteMode: "permanent", maxDepth: 10 });
				const actions = yield* FileActions;
				const res = yield* actions.batchDelete([victim, join(scanRoot, "missing")]);
				const stats = yield* Stats;
				yield* stats.recordDeletion(res.deletedSize, res.deletedCount);
				return { res, summary: yield* stats.summary(30) };
			}),
		);
		expect(existsSync(victim)).toBe(false);
		expect(result.res.deletedCount).toBe(1);
		expect(result.res.errors).toEqual([`${join(scanRoot, "missing")}: not found`]);
		expect(result.summary.totalDeleted).toBe(1);
		expect(result.summary.totalFreed).toBe(result.res.deletedSize);
	});

	test("listDirSuggestions completes directory prefixes", async () => {
		const suggestions = await run(FileActions.use((a) => a.listDirSuggestions(join(scanRoot, "pr"))));
		expect(suggestions).toEqual([join(scanRoot, "proj")]);
	});
});
