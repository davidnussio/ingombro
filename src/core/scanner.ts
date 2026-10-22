import { readdirSync, statSync } from "fs";
import { basename, join } from "path";
import { ScanCancelledError, type CancelToken, type DirEntry, type ScanProgress } from "./types";

export interface ScanOptions {
	maxDepth?: number;
	cancel?: CancelToken;
	/** Called for every directory visited; may yield to the event loop. */
	onProgress?: (progress: ScanProgress) => Promise<void> | void;
}

/**
 * Recursively scan `rootPath`. Sizes use `blocks * 512` (real disk usage).
 * Hidden entries, node_modules and .Trash are skipped, as in the desktop app.
 * Throws ScanCancelledError when `cancel.cancelled` becomes true.
 */
export async function scanDirectory(rootPath: string, opts: ScanOptions = {}): Promise<{ tree: DirEntry; progress: ScanProgress }> {
	const maxDepth = opts.maxDepth ?? 10;
	const cancel = opts.cancel ?? { cancelled: false };
	const progress: ScanProgress = { dirs: 0, files: 0, currentDir: rootPath };
	const onProgress = opts.onProgress ?? (() => {});

	function getDirSizeShallow(dirPath: string): number {
		let total = 0;
		try {
			const items = readdirSync(dirPath, { withFileTypes: true });
			for (const item of items) {
				if (item.name.startsWith(".")) continue;
				try {
					const fullPath = join(dirPath, item.name);
					if (item.isFile()) {
						const stat = statSync(fullPath, { throwIfNoEntry: false });
						total += stat ? (stat.blocks ?? 0) * 512 : 0;
						progress.files++;
					} else if (item.isDirectory()) {
						total += getDirSizeShallow(fullPath);
						progress.dirs++;
					}
				} catch {}
			}
		} catch {}
		return total;
	}

	async function walk(dirPath: string, depth: number): Promise<DirEntry> {
		const entry: DirEntry = { path: dirPath, name: basename(dirPath) || dirPath, size: 0, isDir: true, children: [] };
		if (cancel.cancelled) throw new ScanCancelledError();

		progress.dirs++;
		progress.currentDir = dirPath;
		await onProgress(progress);

		try {
			const items = readdirSync(dirPath, { withFileTypes: true });
			for (const item of items) {
				if (cancel.cancelled) throw new ScanCancelledError();
				if (item.name.startsWith(".") || item.name === "node_modules" || item.name === ".Trash") continue;

				const fullPath = join(dirPath, item.name);
				try {
					if (item.isDirectory()) {
						if (depth < maxDepth) {
							const child = await walk(fullPath, depth + 1);
							entry.children!.push(child);
							entry.size += child.size;
						} else {
							const size = getDirSizeShallow(fullPath);
							entry.children!.push({ path: fullPath, name: item.name, size, isDir: true });
							entry.size += size;
							progress.dirs++;
						}
					} else if (item.isFile()) {
						const stat = statSync(fullPath, { throwIfNoEntry: false });
						const fileSize = stat ? (stat.blocks ?? 0) * 512 : 0;
						entry.children!.push({ path: fullPath, name: item.name, size: fileSize, isDir: false });
						entry.size += fileSize;
						progress.files++;
					}
				} catch (e) {
					if (e instanceof ScanCancelledError) throw e;
				}
			}
		} catch (e) {
			if (e instanceof ScanCancelledError) throw e;
		}

		entry.children?.sort((a, b) => b.size - a.size);
		return entry;
	}

	const tree = await walk(rootPath, 0);
	return { tree, progress };
}

/** Throttled progress callback that also yields to the event loop (keeps UIs responsive). */
export function throttledProgress(fn: (p: ScanProgress) => void, intervalMs = 100) {
	let last = 0;
	return async (p: ScanProgress) => {
		const now = Date.now();
		if (now - last > intervalMs) {
			last = now;
			fn(p);
			await Bun.sleep(1);
		}
	};
}

/** Full recursive size (includes hidden entries). */
export function getDirSizeRecursive(dirPath: string): number {
	let total = 0;
	try {
		const items = readdirSync(dirPath, { withFileTypes: true });
		for (const item of items) {
			try {
				const fullPath = join(dirPath, item.name);
				if (item.isFile() || item.isSymbolicLink()) {
					const stat = statSync(fullPath, { throwIfNoEntry: false });
					total += stat ? (stat.blocks ?? 0) * 512 : 0;
				} else if (item.isDirectory()) {
					total += getDirSizeRecursive(fullPath);
				}
			} catch {}
		}
	} catch {}
	return total;
}

/** Size of a file or directory path. */
export function getPathSize(p: string): number {
	const stat = statSync(p, { throwIfNoEntry: false });
	if (!stat) return 0;
	return stat.isDirectory() ? getDirSizeRecursive(p) : (stat.blocks ?? 0) * 512;
}
