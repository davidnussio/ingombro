import { BrowserView, BrowserWindow, Screen } from "electrobun/bun";
import { existsSync, statSync, readdirSync, rmSync } from "fs";
import { join, basename, resolve } from "path";
import { homedir } from "os";

// --- Types ---
interface DirEntry {
	path: string;
	name: string;
	size: number;
	children?: DirEntry[];
	isDir: boolean;
}

interface CacheData {
	timestamp: number;
	rootPath: string;
	tree: DirEntry;
}

// --- Progress tracking ---
let scanStats = { dirs: 0, files: 0, currentDir: "" };

// --- Resolve ~ in paths ---
function expandPath(p: string): string {
	if (p.startsWith("~/")) return join(homedir(), p.slice(2));
	if (p === "~") return homedir();
	return resolve(p);
}

// --- Cache ---
const CACHE_FILE = join(homedir(), ".diskscanner_cache.json");

async function loadCache(): Promise<CacheData | null> {
	try {
		if (existsSync(CACHE_FILE)) {
			const text = await Bun.file(CACHE_FILE).text();
			return JSON.parse(text) as CacheData;
		}
	} catch {}
	return null;
}

function saveCache(data: CacheData) {
	try {
		Bun.write(CACHE_FILE, JSON.stringify(data));
	} catch (e) {
		console.error("[disk-scanner] Failed to save cache:", e);
	}
}

// --- Filesystem Scanner (with progress) ---
function scanDirectory(dirPath: string, depth: number = 0, maxDepth: number = 3, sendProgress: () => void = () => {}): DirEntry {
	const name = basename(dirPath) || dirPath;
	const entry: DirEntry = { path: dirPath, name, size: 0, isDir: true, children: [] };

	scanStats.dirs++;
	scanStats.currentDir = dirPath;
	sendProgress();

	try {
		const items = readdirSync(dirPath, { withFileTypes: true });
		for (const item of items) {
			if (item.name.startsWith(".") || item.name === "node_modules" || item.name === ".Trash") continue;

			const fullPath = join(dirPath, item.name);
			try {
				if (item.isDirectory()) {
					if (depth < maxDepth) {
						const child = scanDirectory(fullPath, depth + 1, maxDepth, sendProgress);
						entry.children!.push(child);
						entry.size += child.size;
					} else {
						const size = getDirSizeShallow(fullPath);
						entry.children!.push({ path: fullPath, name: item.name, size, isDir: true });
						entry.size += size;
						scanStats.dirs++;
					}
				} else if (item.isFile()) {
					const stat = statSync(fullPath, { throwIfNoEntry: false });
					const fileSize = stat?.size ?? 0;
					entry.children!.push({ path: fullPath, name: item.name, size: fileSize, isDir: false });
					entry.size += fileSize;
					scanStats.files++;
				}
			} catch {}
		}
	} catch {}

	entry.children?.sort((a, b) => b.size - a.size);
	return entry;
}

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
					total += stat?.size ?? 0;
					scanStats.files++;
				} else if (item.isDirectory()) {
					total += getDirSizeShallow(fullPath);
					scanStats.dirs++;
				}
			} catch {}
		}
	} catch {}
	return total;
}

function removeDirFromCache(cache: CacheData, targetPath: string): boolean {
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
	return removeFromEntry(cache.tree) > 0;
}

// --- Window & RPC ---
const display = Screen.getPrimaryDisplay();
const workArea = display.workArea;

const rpc = BrowserView.defineRPC<{
	bun: {
		requests: {
			scanDirectory: { params: { dirPath: string }; response: { success: boolean; error?: string } };
			getChildren: { params: { dirPath: string }; response: { children: DirEntry[] } };
			deleteEntry: { params: { entryPath: string }; response: { success: boolean; error?: string } };
			checkCache: { params: {}; response: { hasCache: boolean; timestamp?: number; rootPath?: string } };
		};
		messages: {};
	};
	webview: {
		requests: {};
		messages: {
			scanProgress: { currentDir: string; dirs: number; files: number };
			scanComplete: { tree: DirEntry };
			cacheFound: { timestamp: number; rootPath: string };
			error: { message: string };
		};
	};
}>({
	maxRequestTime: 300000,
	handlers: {
		requests: {
			checkCache: async () => {
				const cache = await loadCache();
				if (cache) {
					rpc.send.cacheFound({
						timestamp: cache.timestamp,
						rootPath: cache.rootPath,
					});
					return { hasCache: true, timestamp: cache.timestamp, rootPath: cache.rootPath };
				}
				return { hasCache: false };
			},
			scanDirectory: async ({ dirPath }) => {
				const targetPath = expandPath(dirPath || "~");
				console.log(`[disk-scanner] Scanning: ${targetPath}`);

				if (!existsSync(targetPath)) {
					rpc.send.error({ message: `Directory non trovata: ${targetPath}` });
					return { success: false, error: "Directory not found" };
				}

				scanStats = { dirs: 0, files: 0, currentDir: targetPath };

				// Send progress periodically
				let lastProgressTime = 0;
				const sendProgress = () => {
					const now = Date.now();
					if (now - lastProgressTime > 150) {
						lastProgressTime = now;
						rpc.send.scanProgress({
							currentDir: scanStats.currentDir,
							dirs: scanStats.dirs,
							files: scanStats.files,
						});
					}
				};

				try {
					const tree = scanDirectory(targetPath, 0, 3, sendProgress);
					const cacheData: CacheData = {
						timestamp: Date.now(),
						rootPath: targetPath,
						tree,
					};
					saveCache(cacheData);
					rpc.send.scanComplete({ tree });
					return { success: true };
				} catch (e: any) {
					rpc.send.error({ message: e.message });
					return { success: false, error: e.message };
				}
			},
			getChildren: async ({ dirPath }) => {
				const resolved = expandPath(dirPath || "~");
				const cache = await loadCache();
				if (cache) {
					function findEntry(entry: DirEntry): DirEntry | null {
						if (entry.path === resolved) return entry;
						if (entry.children) {
							for (const child of entry.children) {
								const found = findEntry(child);
								if (found) return found;
							}
						}
						return null;
					}
					const found = findEntry(cache.tree);
					if (found) return { children: found.children || [] };
				}
				const tree = scanDirectory(resolved, 0, 1);
				return { children: tree.children || [] };
			},
			deleteEntry: async ({ entryPath }) => {
				try {
					const resolved = expandPath(entryPath);
					if (!existsSync(resolved)) {
						return { success: false, error: "Path does not exist" };
					}
					rmSync(resolved, { recursive: true, force: true });

					const cache = await loadCache();
					if (cache) {
						removeDirFromCache(cache, resolved);
						saveCache(cache);
						rpc.send.scanComplete({ tree: cache.tree });
					}
					return { success: true };
				} catch (e: any) {
					return { success: false, error: e.message };
				}
			},
		},
		messages: {},
	},
});

const mainWin = new BrowserWindow({
	title: "Disk Scanner",
	url: "views://mainview/index.html",
	frame: {
		width: 1100,
		height: 750,
		x: workArea.x + Math.round((workArea.width - 1100) / 2),
		y: workArea.y + Math.round((workArea.height - 750) / 2),
	},
	titleBarStyle: "hiddenInset",
	transparent: false,
	rpc,
});
