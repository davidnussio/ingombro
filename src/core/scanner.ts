import { readdir } from "fs/promises";
import { statSync, type Dirent } from "fs";
import { basename, join } from "path";
import { Clock, Context, Effect, Layer } from "effect";
import type { DirEntry, ScanProgress } from "./types";

// The walkers below list each directory asynchronously, then stat its entries synchronously.
// Async stats per entry are several times slower on large trees; a synchronous listing,
// however, can block the whole process for minutes when the OS stalls (cloud-backed or
// privacy-protected folders), and then not even the cancel request gets through.
// One step per directory keeps every walk interruptible (cancel = interrupt the fiber),
// and `breathe` pauses regularly so Bun keeps serving I/O meanwhile.

/** Real disk usage (`blocks * 512`), 0 if the entry vanished. */
function diskUsage(fullPath: string): number {
	const stat = statSync(fullPath, { throwIfNoEntry: false });
	return stat ? (stat.blocks ?? 0) * 512 : 0;
}

/** Directory entries, empty when unreadable. */
export const readDirEntries = (dirPath: string): Effect.Effect<Dirent[]> =>
	Effect.promise(() => readdir(dirPath, { withFileTypes: true }).catch((): Dirent[] => []));

/**
 * Returns an effect that sleeps for 1ms when `intervalMs` has passed since the last pause.
 * A synchronous stretch longer than that would block Bun from serving RPC/HTTP requests,
 * including the one that cancels the walk.
 */
export const makeEventLoopBreather = (intervalMs = 50) => {
	let last = Date.now();
	return Effect.suspend(() => {
		if (Date.now() - last < intervalMs) return Effect.void;
		return Effect.sleep("1 millis").pipe(Effect.ensuring(Effect.sync(() => (last = Date.now()))));
	});
};

/**
 * Sum `visit` over every directory below (and including) `dirPath`, one directory per step.
 * `visit` returns the size it found in that directory and pushes subdirectories to walk.
 */
const sumTree = (
	dirPath: string,
	visit: (dir: string, items: Dirent[], push: (sub: string) => void) => number,
	breathe: Effect.Effect<void>,
) =>
	Effect.gen(function* () {
		let total = 0;
		const stack = [dirPath];
		while (stack.length > 0) {
			const dir = stack.pop()!;
			const items = yield* readDirEntries(dir);
			total += yield* Effect.sync(() => visit(dir, items, (sub) => stack.push(sub)));
			yield* breathe;
		}
		return total;
	});

/** Full recursive size (includes hidden entries). */
const dirSize = (dirPath: string) =>
	sumTree(
		dirPath,
		(dir, items, push) => {
			let total = 0;
			for (const item of items) {
				try {
					const fullPath = join(dir, item.name);
					if (item.isFile() || item.isSymbolicLink()) total += diskUsage(fullPath);
					else if (item.isDirectory()) push(fullPath);
				} catch {}
			}
			return total;
		},
		makeEventLoopBreather(),
	);

export interface ScanOptions {
	readonly maxDepth?: number;
	/** Receives progress at most every `progressIntervalMs` (default 100ms). */
	readonly onProgress?: (progress: ScanProgress) => Effect.Effect<void>;
	readonly progressIntervalMs?: number;
}

export interface ScanResult {
	readonly tree: DirEntry;
	readonly progress: ScanProgress;
}

/**
 * Recursive directory scanner. Sizes use `blocks * 512` (real disk usage).
 * Hidden folders and node_modules are summed but not explored (leaves without children), so totals
 * match real disk usage; .Trash is skipped. Interrupting the fiber cancels a scan.
 */
export class Scanner extends Context.Service<
	Scanner,
	{
		scan(rootPath: string, options?: ScanOptions): Effect.Effect<ScanResult>;
		/** Full recursive size of a directory (includes hidden entries). */
		dirSize(dirPath: string): Effect.Effect<number>;
		/** Size of a file or directory path, 0 if missing. */
		pathSize(path: string): Effect.Effect<number>;
	}
>()("ingombro/core/Scanner") {
	static readonly layer = Layer.succeed(
		Scanner,
		Scanner.of({
			scan: Effect.fn("Scanner.scan")(function* (rootPath: string, options: ScanOptions = {}) {
				const maxDepth = options.maxDepth ?? 10;
				const interval = options.progressIntervalMs ?? 100;
				const progress = { dirs: 0, files: 0, currentDir: rootPath };
				const breathe = makeEventLoopBreather();
				let lastReport = 0;

				const report = Effect.gen(function* () {
					if (!options.onProgress) return;
					const now = yield* Clock.currentTimeMillis;
					if (now - lastReport <= interval) return;
					lastReport = now;
					yield* options.onProgress({ ...progress });
				});

				// Folders below maxDepth, hidden folders and node_modules are only summed (no tree nodes)
				const summarize = (dirPath: string) =>
					sumTree(
						dirPath,
						(dir, items, push) => {
							let total = 0;
							for (const item of items) {
								try {
									const fullPath = join(dir, item.name);
									if (item.isFile()) {
										total += diskUsage(fullPath);
										progress.files++;
									} else if (item.isDirectory()) {
										push(fullPath);
										progress.dirs++;
									}
								} catch {}
							}
							return total;
						},
						breathe,
					);

				const walk = (dirPath: string, depth: number): Effect.Effect<DirEntry> =>
					Effect.gen(function* () {
						progress.dirs++;
						progress.currentDir = dirPath;
						yield* report;
						yield* breathe;

						const children: DirEntry[] = [];
						let size = 0;
						const subdirs: string[] = [];
						const summarized: { path: string; name: string }[] = [];
						const items = yield* readDirEntries(dirPath);
						yield* Effect.sync(() => {
							for (const item of items) {
								if (item.name === ".Trash") continue;
								const fullPath = join(dirPath, item.name);
								try {
									if (item.isDirectory()) {
										const opaque = item.name.startsWith(".") || item.name === "node_modules";
										if (depth < maxDepth && !opaque) subdirs.push(fullPath);
										else summarized.push({ path: fullPath, name: item.name });
									} else if (item.isFile()) {
										const fileSize = diskUsage(fullPath);
										children.push({ path: fullPath, name: item.name, size: fileSize, isDir: false });
										size += fileSize;
										progress.files++;
									}
								} catch {}
							}
						});
						for (const dir of summarized) {
							const dirSize = yield* summarize(dir.path);
							children.push({ ...dir, size: dirSize, isDir: true });
							size += dirSize;
							progress.dirs++;
						}
						for (const sub of subdirs) {
							const child = yield* walk(sub, depth + 1);
							children.push(child);
							size += child.size;
						}
						children.sort((a, b) => b.size - a.size);
						return { path: dirPath, name: basename(dirPath) || dirPath, size, isDir: true, children };
					});

				const tree = yield* walk(rootPath, 0);
				return { tree, progress: { ...progress } };
			}),
			dirSize,
			pathSize: (path) =>
				Effect.suspend(() => {
					const stat = statSync(path, { throwIfNoEntry: false });
					if (!stat) return Effect.succeed(0);
					return stat.isDirectory() ? dirSize(path) : Effect.succeed((stat.blocks ?? 0) * 512);
				}),
		}),
	);
}
