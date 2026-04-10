import { BrowserView, BrowserWindow, Screen, ApplicationMenu } from "electrobun/bun";
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

interface CacheEntry {
	timestamp: number;
	rootPath: string;
	tree: DirEntry;
}

interface CacheData {
	entries: CacheEntry[];
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
const MAX_CACHE_ENTRIES = 10;
const CACHE_FILE = join(homedir(), ".diskscanner_cache.json");

async function loadCacheStore(): Promise<CacheData> {
	try {
		if (existsSync(CACHE_FILE)) {
			const text = await Bun.file(CACHE_FILE).text();
			const parsed = JSON.parse(text);
			// Migrate old single-entry format
			if (parsed && !parsed.entries && parsed.rootPath) {
				return { entries: [{ timestamp: parsed.timestamp, rootPath: parsed.rootPath, tree: parsed.tree }] };
			}
			return parsed as CacheData;
		}
	} catch {}
	return { entries: [] };
}

function saveCacheStore(data: CacheData) {
	try {
		Bun.write(CACHE_FILE, JSON.stringify(data));
	} catch (e) {
		console.error("[disk-scanner] Failed to save cache:", e);
	}
}

function upsertCacheEntry(store: CacheData, entry: CacheEntry): CacheData {
	const filtered = store.entries.filter((e) => e.rootPath !== entry.rootPath);
	filtered.unshift(entry);
	return { entries: filtered.slice(0, MAX_CACHE_ENTRIES) };
}

function findCacheEntry(store: CacheData, rootPath: string): CacheEntry | null {
	return store.entries.find((e) => e.rootPath === rootPath) || null;
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
					// Use blocks * 512 for real disk usage (handles sparse files correctly)
					const fileSize = stat ? (stat.blocks ?? 0) * 512 : 0;
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
					total += stat ? (stat.blocks ?? 0) * 512 : 0;
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

function removeDirFromCacheEntry(cacheEntry: CacheEntry, targetPath: string): boolean {
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
	return removeFromEntry(cacheEntry.tree) > 0;
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
			getCacheList: { params: {}; response: { entries: { rootPath: string; timestamp: number }[] } };
			deleteCacheEntry: { params: { rootPath: string }; response: { success: boolean } };
			listDir: { params: { partial: string }; response: { suggestions: string[] } };
			validatePath: { params: { dirPath: string }; response: { valid: boolean } };
		};
		messages: {};
	};
	webview: {
		requests: {};
		messages: {
			scanProgress: { currentDir: string; dirs: number; files: number };
			scanComplete: { tree: DirEntry };
			error: { message: string };
		};
	};
}>({
	maxRequestTime: 300000,
	handlers: {
		requests: {
			getCacheList: async () => {
				const store = await loadCacheStore();
				// Deduplica per rootPath (tieni solo la più recente)
				const seen = new Set<string>();
				const unique = store.entries.filter((e) => {
					if (seen.has(e.rootPath)) return false;
					seen.add(e.rootPath);
					return true;
				});
				return {
					entries: unique.map((e) => ({ rootPath: e.rootPath, timestamp: e.timestamp })),
				};
			},
			deleteCacheEntry: async ({ rootPath }) => {
				const store = await loadCacheStore();
				store.entries = store.entries.filter((e) => e.rootPath !== rootPath);
				saveCacheStore(store);
				return { success: true };
			},
			scanDirectory: async ({ dirPath }) => {
				const targetPath = expandPath(dirPath || "~");
				console.log(`[disk-scanner] Scanning: ${targetPath}`);

				if (!existsSync(targetPath)) {
					rpc.send.error({ message: `Directory non trovata: ${targetPath}` });
					return { success: false, error: "Directory not found" };
				}

				scanStats = { dirs: 0, files: 0, currentDir: targetPath };

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
					const entry: CacheEntry = { timestamp: Date.now(), rootPath: targetPath, tree };
					const store = await loadCacheStore();
					saveCacheStore(upsertCacheEntry(store, entry));
					rpc.send.scanComplete({ tree });
					return { success: true };
				} catch (e: any) {
					rpc.send.error({ message: e.message });
					return { success: false, error: e.message };
				}
			},
			getChildren: async ({ dirPath }) => {
				const resolved = expandPath(dirPath || "~");
				const store = await loadCacheStore();
				// Find the cache entry whose rootPath matches or contains the resolved path
				for (const cacheEntry of store.entries) {
					if (resolved.startsWith(cacheEntry.rootPath) || cacheEntry.rootPath === resolved) {
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
						const found = findEntry(cacheEntry.tree);
						if (found) return { children: found.children || [] };
					}
				}
				const tree = scanDirectory(resolved, 0, 1);
				return { children: tree.children || [] };
			},
			validatePath: async ({ dirPath }) => {
				try {
					const resolved = expandPath(dirPath || "");
					if (!resolved || !existsSync(resolved)) return { valid: false };
					const stat = statSync(resolved, { throwIfNoEntry: false });
					return { valid: !!stat?.isDirectory() };
				} catch {
					return { valid: false };
				}
			},
			listDir: async ({ partial }) => {
				try {
					const input = partial || "~";
					const expanded = expandPath(input);
					let dirToList: string;
					let prefix = "";

					// Determine whether to list the directory itself or filter its parent
					const endsWithSlash = input.endsWith("/");
					const isExactDir = existsSync(expanded) && statSync(expanded, { throwIfNoEntry: false })?.isDirectory();

					if (endsWithSlash || (isExactDir && (input === "~" || input === "/" || input.endsWith("/")))) {
						dirToList = expanded;
					} else if (isExactDir) {
						// User typed e.g. "~/Downloads" which is a valid dir — list its contents
						dirToList = expanded;
					} else {
						// Partial name — list parent and filter
						dirToList = join(expanded, "..");
						prefix = basename(expanded).toLowerCase();
					}

					if (!existsSync(dirToList)) return { suggestions: [] };

					const items = readdirSync(dirToList, { withFileTypes: true });
					const home = homedir();
					const suggestions: string[] = [];

					for (const item of items) {
						if (!item.isDirectory() || item.name.startsWith(".")) continue;
						if (prefix && !item.name.toLowerCase().startsWith(prefix)) continue;
						const fullPath = join(dirToList, item.name);
						const display = fullPath.startsWith(home) ? "~" + fullPath.slice(home.length) : fullPath;
						suggestions.push(display);
						if (suggestions.length >= 20) break;
					}

					suggestions.sort();
					return { suggestions };
				} catch (e) {
					console.error("[disk-scanner] listDir error:", e);
					return { suggestions: [] };
				}
			},
			deleteEntry: async ({ entryPath }) => {
				try {
					const resolved = expandPath(entryPath);
					if (!existsSync(resolved)) {
						return { success: false, error: "Path does not exist" };
					}
					rmSync(resolved, { recursive: true, force: true });

					const store = await loadCacheStore();
					// Update all cache entries that might contain this path
					for (const cacheEntry of store.entries) {
						if (removeDirFromCacheEntry(cacheEntry, resolved)) {
							saveCacheStore(store);
							rpc.send.scanComplete({ tree: cacheEntry.tree });
							break;
						}
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

// --- Application Menu (enables Cmd+C, Cmd+V, etc.) ---
ApplicationMenu.setApplicationMenu([
	{
		label: "Disk Scanner",
		submenu: [
			{ role: "about" },
			{ type: "separator" },
			{ role: "hide", accelerator: "CmdOrCtrl+H" },
			{ role: "hideOthers", accelerator: "CmdOrCtrl+Shift+H" },
			{ role: "showAll" },
			{ type: "separator" },
			{ role: "quit", accelerator: "CmdOrCtrl+Q" },
		],
	},
	{
		label: "Edit",
		submenu: [
			{ role: "undo", accelerator: "CmdOrCtrl+Z" },
			{ role: "redo", accelerator: "CmdOrCtrl+Shift+Z" },
			{ type: "separator" },
			{ role: "cut", accelerator: "CmdOrCtrl+X" },
			{ role: "copy", accelerator: "CmdOrCtrl+C" },
			{ role: "paste", accelerator: "CmdOrCtrl+V" },
			{ role: "selectAll", accelerator: "CmdOrCtrl+A" },
		],
	},
]);
