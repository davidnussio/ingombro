import { Effect, Exit, Cause, Fiber, FiberHandle, Option } from "effect";
import {
	type AppSettings,
	type CleanableResult,
	type CoreServices,
	type DirEntry,
	type EntryInfo,
	CacheStore,
	Cleanables,
	EntryInfoReader,
	Envsec,
	FileActions,
	Scanner,
	Settings,
	Stats,
	expandPath,
	findChildrenInStore,
	listCacheEntries,
	normalizeSettings,
} from "../core";
import { AppUpdater } from "./updater";

export type DesktopRPC = {
	bun: {
		requests: {
			scanDirectory: { params: { dirPath: string }; response: { success: boolean; rootPath?: string; error?: string } };
			getChildren: { params: { dirPath: string }; response: { children: readonly DirEntry[] } };
			deleteEntry: { params: { entryPath: string }; response: { success: boolean; error?: string; rootPath?: string } };
			getCacheList: { params: {}; response: { entries: { rootPath: string; timestamp: number; size: number }[] } };
			deleteCacheEntry: { params: { rootPath: string }; response: { success: boolean } };
			listDir: { params: { partial: string }; response: { suggestions: readonly string[] } };
			validatePath: { params: { dirPath: string }; response: { valid: boolean } };
			getSettings: { params: {}; response: AppSettings };
			saveSettings: { params: { maxCacheEntries: number; deleteMode: string; maxDepth: number }; response: { success: boolean } };
			detectCleanables: { params: { rootPath: string }; response: CleanableResult };
			getCachedCleanables: { params: { rootPath: string }; response: { found: boolean; cleanables?: CleanableResult } };
			saveCachedCleanables: { params: { rootPath: string; cleanables: CleanableResult }; response: { success: boolean } };
			batchDelete: { params: { paths: string[] }; response: { success: boolean; deletedCount: number; deletedSize: number; errors: readonly string[] } };
			getEntryInfo: { params: { entryPath: string }; response: EntryInfo | { error: string } };
			cancelScan: { params: {}; response: { success: boolean } };
			getStats: { params: { days: number }; response: { entries: readonly { date: string; freedBytes: number; deleteCount: number }[]; totalFreed: number; totalDeleted: number } };
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
			scanProgress: { currentDir: string; dirs: number; files: number };
			error: { message: string };
			updateAvailable: { version: string };
			updateReady: { version: string };
			updateError: { message: string };
		};
	};
};

type Requests = DesktopRPC["bun"]["requests"];
type WebviewMessages = DesktopRPC["webview"]["messages"];

/** Messages pushed to the webview. */
export type WebviewSender = { readonly [K in keyof WebviewMessages]: (payload: WebviewMessages[K]) => void };

/** Request handlers that only need the window, supplied by the host (Electrobun or the UI preview). */
export type WindowRequests = "getWindowPosition" | "moveWindow";

export type RequestHandlers = {
	readonly [K in Exclude<keyof Requests, WindowRequests>]: (params: Requests[K]["params"]) => Promise<Requests[K]["response"]>;
};

/**
 * Every webview request, implemented on the core services. Shared by the Electrobun main process
 * and the browser UI preview (scripts/ui-preview). Must run inside a scope: it owns the active scan.
 */
export const makeRequestHandlers = Effect.fnUntraced(function* (send: WebviewSender) {
	const context = yield* Effect.context<CoreServices | AppUpdater>();
	// Handlers are plain async callbacks: run each request as an effect on the app's services
	const run = Effect.runPromiseWith(context);

	const settings = yield* Settings;
	const cache = yield* CacheStore;
	const stats = yield* Stats;
	const scanner = yield* Scanner;
	const cleanables = yield* Cleanables;
	const entryInfo = yield* EntryInfoReader;
	const actions = yield* FileActions;
	const envsec = yield* Envsec;
	const updater = yield* AppUpdater;

	// The active scan (cancellable from the UI); starting a new one interrupts the previous
	const activeScan = yield* FiberHandle.make<unknown, unknown>();

	const scanDirectory = Effect.fn("rpc.scanDirectory")(function* (dirPath: string) {
		const targetPath = expandPath(dirPath || "~");
		yield* Effect.log(`[scan] === REQUEST RECEIVED === dirPath="${dirPath}" targetPath="${targetPath}"`);
		if (!(yield* actions.isDirectory(targetPath))) return { success: false, error: "Directory not found" };
		const { maxDepth } = yield* settings.get;
		yield* Effect.log(`[scan] Starting scan (maxDepth=${maxDepth})...`);

		const scan = scanner
			.scan(targetPath, {
				maxDepth,
				progressIntervalMs: 200,
				onProgress: (p) => Effect.sync(() => send.scanProgress(p)),
			})
			.pipe(
				Effect.timed,
				Effect.tap(([elapsed, { tree, progress }]) =>
					Effect.log(
						`[scan] Scan complete in ${elapsed.toString()} — dirs=${progress.dirs} files=${progress.files} treeSize=${tree.size}`,
					),
				),
				// New scan: don't carry over old cleanables — they'll be re-detected
				Effect.tap(([, { tree }]) => cache.upsert({ timestamp: Date.now(), rootPath: targetPath, tree })),
			);

		const exit = yield* Fiber.await(yield* FiberHandle.run(activeScan, scan));
		if (Exit.isSuccess(exit)) return { success: true, rootPath: targetPath };
		if (Cause.hasInterruptsOnly(exit.cause)) {
			yield* Effect.log("[scan] Scan cancelled by user");
			return { success: false, error: "SCAN_CANCELLED" };
		}
		yield* Effect.logError("[scan] ERROR:", exit.cause);
		return { success: false, error: "Scan failed" };
	});

	const detectCleanables = Effect.fn("rpc.detectCleanables")(function* (rootPath: string) {
		const resolved = expandPath(rootPath);
		if (!(yield* actions.isDirectory(resolved))) return { items: [], totalSize: 0 };
		yield* Effect.log(`[cleanables] Scanning ${resolved}...`);
		const [elapsed, result] = yield* Effect.timed(cleanables.detect(resolved));
		yield* Effect.log(`[cleanables] Found ${result.items.length} items (${result.totalSize} bytes) in ${elapsed.toString()}`);
		return result;
	});

	const checkForUpdate = updater.check.pipe(
		Effect.tap((info) =>
			Effect.log(`[updater] Check result: version=${info.version} available=${info.updateAvailable} ready=${info.updateReady}`),
		),
		Effect.tap((info) => Effect.sync(() => info.updateAvailable && send.updateAvailable({ version: info.version }))),
	);

	const requests: RequestHandlers = {
		getCacheList: () =>
			run(
				cache.load.pipe(
					Effect.map((store) => ({
						entries: listCacheEntries(store),
					})),
				),
			),
		cancelScan: () =>
			run(
				Effect.log("[scan] Cancel requested").pipe(
					Effect.andThen(FiberHandle.clear(activeScan)),
					Effect.as({ success: true }),
				),
			),
		deleteCacheEntry: ({ rootPath }) => run(cache.remove(rootPath).pipe(Effect.as({ success: true }))),
		scanDirectory: ({ dirPath }) => run(scanDirectory(dirPath)),
		getChildren: ({ dirPath }) =>
			run(cache.load.pipe(Effect.map((store) => ({ children: findChildrenInStore(store, expandPath(dirPath || "~")) })))),
		validatePath: ({ dirPath }) => run(actions.isDirectory(dirPath || "").pipe(Effect.map((valid) => ({ valid })))),
		listDir: ({ partial }) => run(actions.listDirSuggestions(partial).pipe(Effect.map((suggestions) => ({ suggestions })))),
		deleteEntry: ({ entryPath }) =>
			run(
				Effect.gen(function* () {
					const result = yield* actions.batchDelete([entryPath]);
					if (!result.success) return { success: false, error: result.errors[0]?.replace(/^.*?: /, "") };
					const store = yield* cache.load;
					return { success: true, rootPath: store.entries[0]?.rootPath };
				}),
			),
		getSettings: () => run(settings.get),
		saveSettings: (input) =>
			run(
				Effect.gen(function* () {
					const normalized = normalizeSettings(input);
					yield* settings.save(normalized);
					yield* cache.trim(normalized.maxCacheEntries);
					return { success: true };
				}),
			),
		detectCleanables: ({ rootPath }) => run(detectCleanables(rootPath)),
		getCachedCleanables: ({ rootPath }) =>
			run(
				Effect.gen(function* () {
					const resolved = expandPath(rootPath);
					const entry = yield* cache.findEntry(resolved);
					const found = Option.flatMapNullishOr(entry, (e) => e.cleanables);
					if (Option.isNone(found)) return { found: false };
					yield* Effect.log(`[cleanables] Cache hit for ${resolved} (${found.value.items.length} items)`);
					return { found: true, cleanables: found.value };
				}),
			),
		saveCachedCleanables: ({ rootPath, cleanables }) =>
			run(
				Effect.gen(function* () {
					const resolved = expandPath(rootPath);
					const success = yield* cache.setCleanables(resolved, cleanables);
					if (success) yield* Effect.log(`[cleanables] Saved to cache for ${resolved} (${cleanables.items.length} items)`);
					return { success };
				}),
			),
		batchDelete: ({ paths }) =>
			run(
				actions
					.batchDelete(paths)
					.pipe(Effect.map(({ success, deletedCount, deletedSize, errors }) => ({ success, deletedCount, deletedSize, errors }))),
			),
		getEntryInfo: ({ entryPath }) =>
			run(
				entryInfo.get(entryPath).pipe(
					Effect.catchTag("PathNotFound", () => Effect.succeed({ error: "Cannot read entry info" })),
				),
			),
		getStats: ({ days }) => run(stats.summary(days)),
		recordDeletion: ({ freedBytes, deleteCount }) =>
			run(stats.recordDeletion(freedBytes, deleteCount).pipe(Effect.as({ success: true }))),
		revealInFinder: ({ filePath }) =>
			run(
				actions.reveal(filePath).pipe(
					Effect.as({ success: true }),
					Effect.orElseSucceed(() => ({ success: false })),
				),
			),
		checkEnvsecAvailable: () => run(envsec.isAvailable.pipe(Effect.map((available) => ({ available })))),
		importEnvToEnvsec: ({ filePath, context }) =>
			run(
				envsec.importEnvFile(filePath, context).pipe(
					Effect.map((imported) => ({ success: true, imported })),
					Effect.catchTag("EnvsecError", (e) => Effect.succeed({ success: false, imported: 0, error: e.message })),
				),
			),
		checkForUpdate: () =>
			run(
				checkForUpdate.pipe(
					Effect.map((info) => ({
						version: info.version,
						updateAvailable: info.updateAvailable,
						updateReady: info.updateReady,
					})),
					Effect.catchTag("UpdaterError", (e) =>
						Effect.logError("[updater] Check error:", e.cause).pipe(
							Effect.as({ version: "", updateAvailable: false, updateReady: false, error: e.message }),
						),
					),
				),
			),
		downloadUpdate: () =>
			run(
				Effect.gen(function* () {
					yield* Effect.log("[updater] Starting download...");
					const readyVersion = yield* updater.download;
					yield* Effect.log(`[updater] Download complete, ready=${readyVersion !== undefined}`);
					if (readyVersion !== undefined) send.updateReady({ version: readyVersion });
					return { success: true };
				}).pipe(
					Effect.catchTag("UpdaterError", (e) =>
						Effect.gen(function* () {
							yield* Effect.logError("[updater] Download error:", e.cause);
							send.updateError({ message: e.message });
							return { success: false, error: e.message };
						}),
					),
				),
			),
		applyUpdate: () =>
			run(
				Effect.log("[updater] Applying update...").pipe(
					Effect.andThen(updater.apply),
					Effect.as({ success: true }),
					Effect.catchTag("UpdaterError", (e) =>
						Effect.logError("[updater] Apply error:", e.cause).pipe(Effect.as({ success: false, error: e.message })),
					),
				),
			),
		getAppVersion: () =>
			run(
				updater.localInfo.pipe(
					Effect.map((local) => ({ version: local.version, channel: local.channel })),
					Effect.catchTag("UpdaterError", (e) =>
						Effect.logError("[updater] getLocalInfo error:", e.cause).pipe(
							Effect.as({ version: "unknown", channel: "unknown" }),
						),
					),
				),
			),
	};

	return { requests, checkForUpdate };
});
