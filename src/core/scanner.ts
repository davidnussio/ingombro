import { readdirSync, statSync, type Dirent } from "fs";
import { basename, join } from "path";
import { Clock, Context, Effect, Layer } from "effect";
import type { DirEntry, ScanProgress } from "./types";

// The walkers below read one directory per Effect step with the synchronous fs API.
// Going through the async FileSystem service per entry is several times slower on
// large trees; one effect per directory keeps the scan interruptible (cancel = interrupt
// the fiber) and lets the runtime yield to the event loop so UIs stay responsive.

/** Real disk usage (`blocks * 512`), 0 if the entry vanished. */
function diskUsage(fullPath: string): number {
	const stat = statSync(fullPath, { throwIfNoEntry: false });
	return stat ? (stat.blocks ?? 0) * 512 : 0;
}

function readDir(dirPath: string): Dirent[] {
	try {
		return readdirSync(dirPath, { withFileTypes: true });
	} catch {
		return [];
	}
}

/** Full recursive size (includes hidden entries). */
function dirSizeSync(dirPath: string): number {
	let total = 0;
	for (const item of readDir(dirPath)) {
		try {
			const fullPath = join(dirPath, item.name);
			if (item.isFile() || item.isSymbolicLink()) total += diskUsage(fullPath);
			else if (item.isDirectory()) total += dirSizeSync(fullPath);
		} catch {}
	}
	return total;
}

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
 * Hidden entries, node_modules and .Trash are skipped. Interrupting the fiber cancels a scan.
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
				let lastReport = 0;

				const report = Effect.gen(function* () {
					if (!options.onProgress) return;
					const now = yield* Clock.currentTimeMillis;
					if (now - lastReport <= interval) return;
					lastReport = now;
					yield* options.onProgress({ ...progress });
				});

				function shallowSize(dirPath: string): number {
					let total = 0;
					for (const item of readDir(dirPath)) {
						if (item.name.startsWith(".")) continue;
						try {
							const fullPath = join(dirPath, item.name);
							if (item.isFile()) {
								total += diskUsage(fullPath);
								progress.files++;
							} else if (item.isDirectory()) {
								total += shallowSize(fullPath);
								progress.dirs++;
							}
						} catch {}
					}
					return total;
				}

				const walk = (dirPath: string, depth: number): Effect.Effect<DirEntry> =>
					Effect.gen(function* () {
						progress.dirs++;
						progress.currentDir = dirPath;
						yield* report;

						const children: DirEntry[] = [];
						let size = 0;
						const subdirs: string[] = [];
						yield* Effect.sync(() => {
							for (const item of readDir(dirPath)) {
								if (item.name.startsWith(".") || item.name === "node_modules" || item.name === ".Trash") continue;
								const fullPath = join(dirPath, item.name);
								try {
									if (item.isDirectory()) {
										if (depth < maxDepth) {
											subdirs.push(fullPath);
										} else {
											const dirSize = shallowSize(fullPath);
											children.push({ path: fullPath, name: item.name, size: dirSize, isDir: true });
											size += dirSize;
											progress.dirs++;
										}
									} else if (item.isFile()) {
										const fileSize = diskUsage(fullPath);
										children.push({ path: fullPath, name: item.name, size: fileSize, isDir: false });
										size += fileSize;
										progress.files++;
									}
								} catch {}
							}
						});
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
			dirSize: (dirPath) => Effect.sync(() => dirSizeSync(dirPath)),
			pathSize: (path) =>
				Effect.sync(() => {
					const stat = statSync(path, { throwIfNoEntry: false });
					if (!stat) return 0;
					return stat.isDirectory() ? dirSizeSync(path) : (stat.blocks ?? 0) * 512;
				}),
		}),
	);
}
