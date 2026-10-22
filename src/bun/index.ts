import { BrowserView, BrowserWindow, Screen, ApplicationMenu, Updater } from "electrobun/bun";
import { statSync } from "fs";
import {
	type AppSettings,
	type CacheEntry,
	type CancelToken,
	type CleanableResult,
	type DirEntry,
	type EntryInfo,
	ScanCancelledError,
	batchDelete,
	deleteCacheEntry,
	detectCleanables,
	expandPath,
	findCacheEntry,
	findChildrenInStore,
	getEntryInfo,
	getStats,
	importEnvToEnvsec,
	isDirectory,
	isEnvsecAvailable,
	listCacheEntries,
	listDirSuggestions,
	loadCacheStore,
	loadSettings,
	normalizeSettings,
	recordDeletion,
	revealInFinder,
	saveCacheStore,
	saveSettings,
	scanDirectory,
	throttledProgress,
	upsertCacheEntry,
} from "../core";

// Active scan / Smart Clean detection (cancellable from the UI)
let currentScan: CancelToken = { cancelled: false };

// --- Window & RPC ---
const display = Screen.getPrimaryDisplay();
const workArea = display.workArea;

let mainWin: InstanceType<typeof BrowserWindow> | null = null;

const rpc = BrowserView.defineRPC<{
	bun: {
		requests: {
			scanDirectory: { params: { dirPath: string }; response: { success: boolean; rootPath?: string; error?: string } };
			getChildren: { params: { dirPath: string }; response: { children: DirEntry[] } };
			deleteEntry: { params: { entryPath: string }; response: { success: boolean; error?: string; rootPath?: string } };
			getCacheList: { params: {}; response: { entries: { rootPath: string; timestamp: number }[] } };
			deleteCacheEntry: { params: { rootPath: string }; response: { success: boolean } };
			listDir: { params: { partial: string }; response: { suggestions: string[] } };
			validatePath: { params: { dirPath: string }; response: { valid: boolean } };
			getSettings: { params: {}; response: AppSettings };
			saveSettings: { params: { maxCacheEntries: number; deleteMode: string; maxDepth: number }; response: { success: boolean } };
			detectCleanables: { params: { rootPath: string }; response: CleanableResult };
			getCachedCleanables: { params: { rootPath: string }; response: { found: boolean; cleanables?: CleanableResult } };
			saveCachedCleanables: { params: { rootPath: string; cleanables: CleanableResult }; response: { success: boolean } };
			batchDelete: { params: { paths: string[] }; response: { success: boolean; deletedCount: number; deletedSize: number; errors: string[] } };
			getEntryInfo: { params: { entryPath: string }; response: EntryInfo | { error: string } };
			cancelScan: { params: {}; response: { success: boolean } };
			getStats: { params: { days: number }; response: { entries: { date: string; freedBytes: number; deleteCount: number }[]; totalFreed: number; totalDeleted: number } };
			recordDeletion: { params: { freedBytes: number; deleteCount: number }; response: { success: boolean } };
			revealInFinder: { params: { filePath: string }; response: { success: boolean } };
			checkEnvsecAvailable: { params: {}; response: { available: boolean } };
			importEnvToEnvsec: { params: { filePath: string; context: string }; response: { success: boolean; imported: number; error?: string } };
			checkForUpdate: { params: {}; response: { version: string; updateAvailable: boolean; updateReady: boolean; error?: string } };
			downloadUpdate: { params: {}; response: { success: boolean; error?: string } };
			applyUpdate: { params: {}; response: { success: boolean; error?: string } };
			getAppVersion: { params: {}; response: { version: string; channel: string } };
			getWindowPosition: { params: {}; response: { x: number; y: number } };
			moveWindow: { params: { x: number; y: number }; response: { success: boolean } };
		};
		messages: {};
	};
	webview: {
		requests: {};
		messages: {
			scanProgress: { currentDir: string };
			error: { message: string };
			updateAvailable: { version: string };
			updateReady: { version: string };
			updateError: { message: string };
		};
	};
}>({
	maxRequestTime: 300000,
	handlers: {
		requests: {
			getCacheList: async () => {
				const store = await loadCacheStore();
				return { entries: listCacheEntries(store).map(({ rootPath, timestamp }) => ({ rootPath, timestamp })) };
			},
			cancelScan: async () => {
				console.log("[scan] Cancel requested");
				currentScan.cancelled = true;
				return { success: true };
			},
			deleteCacheEntry: async ({ rootPath }) => {
				await deleteCacheEntry(rootPath);
				return { success: true };
			},
			scanDirectory: async ({ dirPath }) => {
				const targetPath = expandPath(dirPath || "~");
				console.log(`[scan] === REQUEST RECEIVED === dirPath="${dirPath}" targetPath="${targetPath}"`);
				if (!statSync(targetPath, { throwIfNoEntry: false })?.isDirectory()) {
					return { success: false, error: "Directory not found" };
				}
				currentScan = { cancelled: false };
				const settings = await loadSettings();
				console.log(`[scan] Starting scan (maxDepth=${settings.maxDepth})...`);
				const startNs = Bun.nanoseconds();
				try {
					const { tree, progress } = await scanDirectory(targetPath, {
						maxDepth: settings.maxDepth,
						cancel: currentScan,
						onProgress: throttledProgress((p) => rpc.send.scanProgress({ currentDir: p.currentDir }), 200),
					});
					const elapsedMs = (Bun.nanoseconds() - startNs) / 1_000_000;
					console.log(`[scan] Scan complete in ${elapsedMs.toFixed(2)}ms — dirs=${progress.dirs} files=${progress.files} treeSize=${tree.size}`);
					const entry: CacheEntry = { timestamp: Date.now(), rootPath: targetPath, tree };
					// New scan: don't carry over old cleanables — they'll be re-detected
					const store = await loadCacheStore();
					await saveCacheStore(await upsertCacheEntry(store, entry));
					return { success: true, rootPath: targetPath };
				} catch (e: any) {
					if (e instanceof ScanCancelledError) {
						console.log(`[scan] Scan cancelled by user`);
						return { success: false, error: "SCAN_CANCELLED" };
					}
					console.error(`[scan] ERROR:`, e);
					return { success: false, error: e.message };
				}
			},
			getChildren: async ({ dirPath }) => {
				const store = await loadCacheStore();
				return { children: findChildrenInStore(store, expandPath(dirPath || "~")) };
			},
			validatePath: async ({ dirPath }) => {
				return { valid: isDirectory(dirPath || "") };
			},
			listDir: async ({ partial }) => {
				return { suggestions: listDirSuggestions(partial) };
			},
			deleteEntry: async ({ entryPath }) => {
				const result = await batchDelete([entryPath]);
				if (!result.success) return { success: false, error: result.errors[0]?.replace(/^.*?: /, "") };
				const store = await loadCacheStore();
				return { success: true, rootPath: store.entries[0]?.rootPath };
			},
			getSettings: async () => {
				return await loadSettings();
			},
			saveSettings: async (input) => {
				const settings = normalizeSettings(input);
				await saveSettings(settings);
				// Trim cache if needed
				const store = await loadCacheStore();
				if (store.entries.length > settings.maxCacheEntries) {
					store.entries = store.entries.slice(0, settings.maxCacheEntries);
					await saveCacheStore(store);
				}
				return { success: true };
			},
			detectCleanables: async ({ rootPath }) => {
				const resolved = expandPath(rootPath);
				if (!isDirectory(resolved)) return { items: [], totalSize: 0 };
				console.log(`[cleanables] Scanning ${resolved}...`);
				const startNs = Bun.nanoseconds();
				const result = await detectCleanables(resolved, { cancel: currentScan });
				const elapsedMs = (Bun.nanoseconds() - startNs) / 1_000_000;
				console.log(`[cleanables] Found ${result.items.length} items (${result.totalSize} bytes) in ${elapsedMs.toFixed(2)}ms`);
				return result;
			},
			getCachedCleanables: async ({ rootPath }) => {
				const resolved = expandPath(rootPath);
				const entry = findCacheEntry(await loadCacheStore(), resolved);
				if (entry?.cleanables) {
					console.log(`[cleanables] Cache hit for ${resolved} (${entry.cleanables.items.length} items)`);
					return { found: true, cleanables: entry.cleanables };
				}
				return { found: false };
			},
			saveCachedCleanables: async ({ rootPath, cleanables }) => {
				const resolved = expandPath(rootPath);
				const store = await loadCacheStore();
				const entry = findCacheEntry(store, resolved);
				if (!entry) return { success: false };
				entry.cleanables = cleanables;
				await saveCacheStore(store);
				console.log(`[cleanables] Saved to cache for ${resolved} (${cleanables.items.length} items)`);
				return { success: true };
			},
			batchDelete: async ({ paths }) => {
				const { success, deletedCount, deletedSize, errors } = await batchDelete(paths);
				return { success, deletedCount, deletedSize, errors };
			},
			getEntryInfo: async ({ entryPath }) => {
				const info = await getEntryInfo(entryPath);
				if (!info) return { error: "Cannot read entry info" };
				return info;
			},
			getStats: async ({ days }) => {
				return await getStats(days);
			},
			recordDeletion: async ({ freedBytes, deleteCount }) => {
				await recordDeletion(freedBytes, deleteCount);
				return { success: true };
			},
			revealInFinder: async ({ filePath }) => {
				return { success: await revealInFinder(filePath) };
			},
			checkEnvsecAvailable: async () => {
				return { available: await isEnvsecAvailable() };
			},
			importEnvToEnvsec: async ({ filePath, context }) => {
				return await importEnvToEnvsec(filePath, context);
			},
			checkForUpdate: async () => {
				try {
					const updateInfo = await Updater.checkForUpdate();
					console.log(`[updater] Check result: version=${updateInfo.version} available=${updateInfo.updateAvailable} ready=${updateInfo.updateReady}`);
					if (updateInfo.updateAvailable) {
						rpc.send.updateAvailable({ version: updateInfo.version });
					}
					return {
						version: updateInfo.version,
						updateAvailable: updateInfo.updateAvailable,
						updateReady: updateInfo.updateReady,
					};
				} catch (e: any) {
					console.error("[updater] Check error:", e);
					return { version: "", updateAvailable: false, updateReady: false, error: e.message };
				}
			},
			downloadUpdate: async () => {
				try {
					console.log("[updater] Starting download...");
					await Updater.downloadUpdate();
					const info = Updater.updateInfo();
					console.log(`[updater] Download complete, ready=${info?.updateReady}`);
					if (info?.updateReady) {
						rpc.send.updateReady({ version: info.version });
					}
					return { success: true };
				} catch (e: any) {
					console.error("[updater] Download error:", e);
					rpc.send.updateError({ message: e.message });
					return { success: false, error: e.message };
				}
			},
			applyUpdate: async () => {
				try {
					console.log("[updater] Applying update...");
					await Updater.applyUpdate();
					return { success: true };
				} catch (e: any) {
					console.error("[updater] Apply error:", e);
					return { success: false, error: e.message };
				}
			},
			getAppVersion: async () => {
				try {
					const local = await Updater.getLocallocalInfo();
					return { version: local.version, channel: local.channel };
				} catch (e: any) {
					console.error("[updater] getLocalInfo error:", e);
					return { version: "unknown", channel: "unknown" };
				}
			},
			getWindowPosition: async () => {
				const pos = mainWin!.getPosition();
				return { x: pos.x, y: pos.y };
			},
			moveWindow: async ({ x, y }) => {
				mainWin!.setPosition(x, y);
				return { success: true };
			},
		},
		messages: {},
	},
});

mainWin = new BrowserWindow({
	title: "Ingombro",
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

// --- Enforce minimum window size ---
const MIN_WIDTH = 640;
const MIN_HEIGHT = 480;
mainWin.on("resize", (event: any) => {
	const { width, height } = event.data;
	if (width < MIN_WIDTH || height < MIN_HEIGHT) {
		mainWin.setSize(Math.max(width, MIN_WIDTH), Math.max(height, MIN_HEIGHT));
	}
});

// --- Application Menu (enables Cmd+C, Cmd+V, etc.) ---
ApplicationMenu.setApplicationMenu([
	{
		label: "Ingombro",
		submenu: [
			{ role: "about" },
			{ type: "separator" },
			{
				label: "Check for Updates…",
				action: "check-for-updates",
			},
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

// --- Handle "Check for Updates" menu action ---
ApplicationMenu.on("application-menu-clicked", async (event: any) => {
	if (event?.action === "check-for-updates") {
		try {
			console.log("[updater] Manual check from menu...");
			const updateInfo = await Updater.checkForUpdate();
			if (updateInfo.updateAvailable) {
				rpc.send.updateAvailable({ version: updateInfo.version });
			}
		} catch (e) {
			console.error("[updater] Menu check error:", e);
		}
	}
});

// --- Auto-check for updates on startup (after a short delay) ---
setTimeout(async () => {
	try {
		console.log("[updater] Auto-checking for updates...");
		const updateInfo = await Updater.checkForUpdate();
		if (updateInfo.updateAvailable) {
			console.log(`[updater] Update available: ${updateInfo.version}`);
			rpc.send.updateAvailable({ version: updateInfo.version });
		} else {
			console.log("[updater] App is up to date");
		}
	} catch (e) {
		console.error("[updater] Auto-check failed:", e);
	}
}, 5000);

// --- Clean shutdown: cancel active scans on quit ---
process.on("SIGTERM", () => {
	currentScan.cancelled = true;
	process.exit(0);
});
process.on("SIGINT", () => {
	currentScan.cancelled = true;
	process.exit(0);
});
