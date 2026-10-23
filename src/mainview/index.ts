import Electrobun, { Electroview } from "electrobun/view";
import { Context, Duration, Effect, FiberMap, Layer, ManagedRuntime, Predicate, Schema } from "effect";
import { initI18n, t, setLanguage, getLanguage, getLocale, getAvailableLanguages } from "./i18n";

// Initialize i18n before anything else
initI18n();

// --- Types ---
interface DirEntry {
	path: string;
	name: string;
	size: number;
	children?: DirEntry[];
	isDir: boolean;
}

interface CleanableItem {
	path: string;
	projectPath: string;
	projectType: string;
	folderName: string;
	size: number;
	risk: "low" | "medium" | "high";
	category: "dev" | "ml" | "office" | "design" | "video" | "music" | "secrets";
	note?: string;
}

interface CleanableResult {
	items: CleanableItem[];
	totalSize: number;
}

interface EntryInfo {
	path: string;
	name: string;
	size: number;
	isDir: boolean;
	modifiedAt: number;
	createdAt: number;
	fileCount?: number;
	dirCount?: number;
	largestFile?: { name: string; size: number };
	newestFile?: { name: string; modifiedAt: number };
	typeDistribution?: { label: string; percentage: number; color: string }[];
	extension?: string;
	previewType?: "text" | "image" | "none";
	textPreview?: string;
}

type AppRPC = {
	bun: {
		requests: {
			scanDirectory: { params: { dirPath: string }; response: { success: boolean; rootPath?: string; error?: string } };
			getChildren: { params: { dirPath: string }; response: { children: DirEntry[] } };
			deleteEntry: { params: { entryPath: string }; response: { success: boolean; error?: string; rootPath?: string } };
			getCacheList: { params: {}; response: { entries: { rootPath: string; timestamp: number; size: number }[] } };
			deleteCacheEntry: { params: { rootPath: string }; response: { success: boolean } };
			listDir: { params: { partial: string }; response: { suggestions: string[] } };
			validatePath: { params: { dirPath: string }; response: { valid: boolean } };
			getSettings: { params: {}; response: { maxCacheEntries: number; deleteMode: string; maxDepth: number } };
			saveSettings: { params: { maxCacheEntries: number; deleteMode: string; maxDepth: number }; response: { success: boolean } };
			detectCleanables: { params: { rootPath: string }; response: CleanableResult };
			getCachedCleanables: { params: { rootPath: string }; response: { found: boolean; cleanables?: CleanableResult } };
			saveCachedCleanables: { params: { rootPath: string; cleanables: CleanableResult }; response: { success: boolean } };
			batchDelete: { params: { paths: string[] }; response: { success: boolean; deletedCount: number; deletedSize: number; errors: string[] } };
			getEntryInfo: { params: { entryPath: string }; response: EntryInfo };
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
			scanProgress: { currentDir: string; dirs: number; files: number };
			error: { message: string };
			updateAvailable: { version: string };
			updateReady: { version: string };
			updateError: { message: string };
		};
	};
};

// --- Backend service (Effect wrapper around the Electroview RPC client) ---
type BunRequests = AppRPC["bun"]["requests"];
type RequestName = keyof BunRequests;
type RequestParams<K extends RequestName> = BunRequests[K]["params"];
type RequestResponse<K extends RequestName> = BunRequests[K]["response"];

/** The subset of the Electroview RPC object the Backend layer needs. */
type RpcClient = {
	readonly request: { readonly [K in RequestName]: (params: RequestParams<K>) => Promise<RequestResponse<K>> };
};

/** An RPC request to the Bun process rejected (transport error, timeout, handler crash). */
class BackendError extends Schema.TaggedError<BackendError>()("BackendError", {
	request: Schema.String,
	cause: Schema.Defect(),
}) {
	override get message() {
		const cause = Predicate.hasProperty(this.cause, "message") ? String(this.cause.message) : String(this.cause);
		return `${this.request}: ${cause}`;
	}
}

class Backend extends Context.Service<
	Backend,
	{ readonly [K in RequestName]: (params: RequestParams<K>) => Effect.Effect<RequestResponse<K>, BackendError> }
>()("ingombro/mainview/Backend") {
	static readonly layer = (client: RpcClient) => {
		const request =
			<K extends RequestName>(name: K) =>
			(params: RequestParams<K>): Effect.Effect<RequestResponse<K>, BackendError> =>
				Effect.tryPromise({
					try: () => client.request[name](params),
					catch: (cause) => new BackendError({ request: name, cause }),
				}).pipe(Effect.withSpan(`Backend.${name}`));

		return Layer.succeed(
			Backend,
			Backend.of({
				scanDirectory: request("scanDirectory"),
				getChildren: request("getChildren"),
				deleteEntry: request("deleteEntry"),
				getCacheList: request("getCacheList"),
				deleteCacheEntry: request("deleteCacheEntry"),
				listDir: request("listDir"),
				validatePath: request("validatePath"),
				getSettings: request("getSettings"),
				saveSettings: request("saveSettings"),
				detectCleanables: request("detectCleanables"),
				getCachedCleanables: request("getCachedCleanables"),
				saveCachedCleanables: request("saveCachedCleanables"),
				batchDelete: request("batchDelete"),
				getEntryInfo: request("getEntryInfo"),
				cancelScan: request("cancelScan"),
				getStats: request("getStats"),
				recordDeletion: request("recordDeletion"),
				revealInFinder: request("revealInFinder"),
				checkEnvsecAvailable: request("checkEnvsecAvailable"),
				importEnvToEnvsec: request("importEnvToEnvsec"),
				checkForUpdate: request("checkForUpdate"),
				downloadUpdate: request("downloadUpdate"),
				applyUpdate: request("applyUpdate"),
				getAppVersion: request("getAppVersion"),
				getWindowPosition: request("getWindowPosition"),
				moveWindow: request("moveWindow"),
			}),
		);
	};
}

// --- UI task slots ---
// Each slot holds at most one running fiber: running a new effect in a slot
// interrupts the previous one. A `sleep` at the start of the effect turns a
// slot into a debounce; a stale in-flight request is dropped the same way.
type UiTask = "autocomplete" | "validatePath" | "autocompleteHide" | "saveSettings" | "toast" | "infoPanel" | "stats";

class UiTasks extends Context.Service<
	UiTasks,
	{ run<R>(task: UiTask, effect: Effect.Effect<void, never, R>): Effect.Effect<void, never, R> }
>()("ingombro/mainview/UiTasks") {
	static readonly layer = Layer.effect(
		UiTasks,
		Effect.gen(function* () {
			const fibers = yield* FiberMap.make<UiTask, void, never>();
			return UiTasks.of({
				run: (task, effect) => Effect.asVoid(FiberMap.run(fibers, task, effect)),
			});
		}),
	);
}

type MainviewServices = Backend | UiTasks;

/** Run `effect` in a UI task slot, interrupting whatever was running there. */
const inSlot = <R>(task: UiTask, effect: Effect.Effect<void, never, R>) => UiTasks.use((tasks) => tasks.run(task, effect));

/** Run `effect` in a UI task slot after `delay`; a new call before then restarts the wait. */
const debounced = <R>(task: UiTask, delay: Duration.Input, effect: Effect.Effect<void, never, R>) =>
	inSlot(task, Effect.andThen(Effect.sleep(delay), effect));

/**
 * Start `effect` without waiting for it (the equivalent of calling an async
 * function without `await`). It starts synchronously, so RPC requests keep the
 * same order as before, and outlives the fiber that started it.
 */
const background = <A, R>(effect: Effect.Effect<A, never, R>) =>
	Effect.asVoid(Effect.forkDetach(effect, { startImmediately: true }));

/** Swallow a failure after logging it (for fire-and-forget requests). */
const logFailure =
	(label: string) =>
	<A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<void, never, R> =>
		self.pipe(
			Effect.asVoid,
			Effect.catch((error) => Effect.logError(label, error)),
		);

const rpc = Electroview.defineRPC<AppRPC>({
	maxRequestTime: 300000,
	handlers: {
		requests: {},
		messages: {
			scanProgress: ({ currentDir, dirs, files }) => {
				const number = new Intl.NumberFormat(getLocale());
				// The element is right-to-left so long paths keep their tail visible; the
				// LRM marks stop a leading "/" from jumping to the end.
				$("scanCurrentDir").textContent = `\u200E${currentDir}\u200E`;
				$("scanCounts").textContent = t().scanningCounts(number.format(dirs), number.format(files));
			},
			error: ({ message }) => run(onBackendErrorMessage(message)),
			updateAvailable: ({ version }) =>
				run(Effect.log(`[fe] Update available: ${version}`).pipe(Effect.andThen(Effect.sync(() => showUpdateBanner(version))))),
			updateReady: ({ version }) =>
				run(Effect.log(`[fe] Update ready: ${version}`).pipe(Effect.andThen(Effect.sync(() => showUpdateReadyBanner(version))))),
			updateError: ({ message }) =>
				run(Effect.logError(`[fe] Update error: ${message}`).pipe(Effect.andThen(Effect.sync(() => hideUpdateBanner())))),
		},
	},
});

const electrobun = new Electrobun.Electroview({ rpc });

// --- Runtime: every DOM / RPC callback runs its effect through here ---
const runtime = ManagedRuntime.make(Layer.mergeAll(Backend.layer(rpc), UiTasks.layer));

function run<A>(effect: Effect.Effect<A, never, MainviewServices>): void {
	runtime.runFork(effect);
}

const onBackendErrorMessage = Effect.fn("onBackendErrorMessage")(function* (message: string) {
	yield* Effect.logError(`[fe] error received: ${message}`);
	alert(t().errorPrefix + " " + message);
	yield* showScreen("welcome");
});

// --- Titlebar drag (manual implementation for WebKit) ---
{
	const titlebar = document.getElementById("titlebar")!;
	let isDragging = false;
	let dragStartX = 0;
	let dragStartY = 0;
	let winStartX = 0;
	let winStartY = 0;

	const startDrag = Effect.fn("startDrag")(function* (e: MouseEvent) {
		const backend = yield* Backend;
		yield* backend.getWindowPosition({}).pipe(
			Effect.tap((pos) =>
				Effect.sync(() => {
					if (pos) {
						winStartX = pos.x;
						winStartY = pos.y;
					}
				}),
			),
			Effect.ignore,
		);
		e.preventDefault();
	});

	titlebar.addEventListener("mousedown", (e: MouseEvent) => {
		// Ignore clicks on interactive children (buttons, inputs, etc.)
		if ((e.target as HTMLElement).closest("button, input, select, a, [data-no-drag]")) return;
		if (e.button !== 0) return;

		isDragging = true;
		dragStartX = e.screenX;
		dragStartY = e.screenY;
		run(startDrag(e));
	});

	window.addEventListener("mousemove", (e: MouseEvent) => {
		if (!isDragging) return;
		const dx = e.screenX - dragStartX;
		const dy = e.screenY - dragStartY;
		run(Backend.use((backend) => backend.moveWindow({ x: winStartX + dx, y: winStartY + dy })).pipe(logFailure("[fe] moveWindow error:")));
	});

	window.addEventListener("mouseup", () => {
		isDragging = false;
	});
}

// --- State ---
let currentTree: DirEntry | null = null;
let navigationStack: DirEntry[] = [];
let pendingDeletePath: string | null = null;
let pendingDeleteSize: number = 0;
let totalFreedBytes: number = 0;
let currentCleanables: CleanableResult | null = null;
let cleanableSelected: Set<string> = new Set();
let activeCleanFilters: Set<string> = new Set(); // empty = show all (no filter)
let isScanning = false;
let envsecAvailable: boolean | null = null; // null = not checked yet

// --- Update banner ---
function showUpdateBanner(version: string) {
	const tr = t();
	$("updateBannerText").textContent = tr.updateAvailableText?.(version) ?? `Version ${version} is available`;
	const action = $("updateBannerAction") as HTMLButtonElement;
	action.textContent = tr.updateDownload ?? "Download";
	action.disabled = false;
	action.onclick = () => {
		action.textContent = tr.updateDownloading ?? "Downloading…";
		action.disabled = true;
		run(Backend.use((backend) => backend.downloadUpdate({})).pipe(logFailure("[fe] downloadUpdate error:")));
	};
	$("updateBanner").classList.remove("hidden");
}

function showUpdateReadyBanner(version: string) {
	const tr = t();
	$("updateBannerText").textContent = tr.updateReadyText?.(version) ?? `Version ${version} is ready to install`;
	const action = $("updateBannerAction") as HTMLButtonElement;
	action.textContent = tr.updateInstall ?? "Restart & Update";
	action.disabled = false;
	action.onclick = () => run(Backend.use((backend) => backend.applyUpdate({})).pipe(logFailure("[fe] applyUpdate error:")));
	$("updateBanner").classList.remove("hidden");
}

function hideUpdateBanner() {
	$("updateBanner").classList.add("hidden");
}

// Returns cleanables scoped to the current navigation path
function getScopedCleanables(): CleanableResult | null {
	if (!currentCleanables || currentCleanables.items.length === 0) return currentCleanables;
	const current = navigationStack[navigationStack.length - 1];
	if (!current || !currentTree || current.path === currentTree.path) return currentCleanables;
	const prefix = current.path.endsWith("/") ? current.path : current.path + "/";
	const items = currentCleanables.items.filter((i) => i.path.startsWith(prefix));
	return { items, totalSize: items.reduce((s, i) => s + i.size, 0) };
}

// Update the clean banner to reflect the current navigation scope
function updateCleanBanner() {
	const banner = $("cleanBanner");
	const scoped = getScopedCleanables();
	if (!scoped || scoped.items.length === 0) {
		banner.classList.add("hidden");
		return;
	}
	showCleanCallout(scoped);
}

/** The Smart Clean callout above the treemap, either analyzing or showing the result. */
function showCleanCallout(result: CleanableResult | "analyzing") {
	const banner = $("cleanBanner");
	banner.classList.remove("hidden");
	const analyzing = result === "analyzing";
	banner.classList.toggle("is-analyzing", analyzing);
	$("cleanBannerMsg").textContent = analyzing ? t().cleanAnalyzing : t().cleanRecoverable(formatSize(result.totalSize), result.items.length);
	$("cleanBannerSub").textContent = analyzing ? "" : t().cleanCalloutSub;
	$("btnOpenClean").classList.toggle("hidden", analyzing);
}

// --- Cancel scan ---
const cancelScan = Effect.fn("cancelScan")(
	function* () {
		if (!isScanning) return;
		yield* Effect.log("[fe] cancelScan requested");
		const backend = yield* Backend;
		yield* backend.cancelScan({});
	},
	Effect.catchTag("BackendError", (e) => Effect.logError("[fe] cancelScan error:", e.cause)),
);

// --- Clean shutdown: cancel any active scan before closing ---
window.addEventListener("beforeunload", () => {
	if (isScanning) {
		run(cancelScan());
	}
});

// Back to the welcome screen and refresh the cached-scans list.
const goToWelcome = Effect.fnUntraced(function* () {
	yield* showScreen("welcome");
	yield* background(renderCacheList());
});

// --- Scan helper ---
const startScan = Effect.fn("startScan")(
	function* (dirPath: string) {
		$("scanTarget").textContent = dirPath;
		$("scanCounts").textContent = "";
		$("scanCurrentDir").textContent = "";
		isScanning = true;
		yield* showScreen("scanning");
		setTitle(dirPath);
		yield* Effect.log(`[fe] startScan: requesting scanDirectory dirPath="${dirPath}"`);
		const backend = yield* Backend;
		const result = yield* backend.scanDirectory({ dirPath });
		yield* Effect.log(`[fe] startScan: response received`, result);
		isScanning = false;
		if (!result || !result.success || !result.rootPath) {
			if (result?.error === "SCAN_CANCELLED") {
				yield* goToWelcome();
				return;
			}
			alert(t().errorPrefix + " " + (result?.error || t().scanFailed));
			yield* goToWelcome();
			return;
		}
		yield* loadTreeFromCache(result.rootPath, false);
		yield* background(renderCacheList());
		yield* background(detectAndShowCleanables(result.rootPath, false));
	},
	Effect.catchTag("BackendError", (e) =>
		Effect.gen(function* () {
			yield* Effect.logError(`[fe] startScan error:`, e.cause);
			isScanning = false;
			yield* goToWelcome();
		}),
	),
);

const loadTreeFromCache = Effect.fn("loadTreeFromCache")(function* (rootPath: string, preserveNav: boolean) {
	yield* Effect.log(`[fe] loadTreeFromCache: rootPath="${rootPath}" preserveNav=${preserveNav}`);
	const backend = yield* Backend;
	const res = yield* backend.getChildren({ dirPath: rootPath });
	if (!res || !res.children || res.children.length === 0) {
		yield* Effect.log(`[fe] loadTreeFromCache: no children`);
		yield* goToWelcome();
		return;
	}
	const tree: DirEntry = {
		path: rootPath,
		name: rootPath.split("/").pop() || rootPath,
		size: res.children.reduce((s: number, c: DirEntry) => s + c.size, 0),
		isDir: true,
		children: res.children,
	};

	if (preserveNav && currentTree !== null && navigationStack.length > 0) {
		const oldPaths = navigationStack.map((e) => e.path);
		const newStack: DirEntry[] = [tree];
		for (let i = 1; i < oldPaths.length; i++) {
			const parent = newStack[newStack.length - 1]!;
			const child = (parent.children || []).find((c) => c.path === oldPaths[i]);
			if (child) {
				newStack.push(child);
			} else {
				break;
			}
		}
		currentTree = tree;
		navigationStack = newStack;
		renderResults(navigationStack[navigationStack.length - 1]!);
	} else {
		currentTree = tree;
		navigationStack = [tree];
		yield* showScreen("results");
		renderResults(tree);
		$("dirList").focus({ preventScroll: true });
	}
});

// --- DOM ---
const $ = (id: string) => document.getElementById(id)!;
const scanPathInput = $("scanPath") as HTMLInputElement;

// --- Screens ---
const showScreen = Effect.fnUntraced(function* (name: "welcome" | "scanning" | "results") {
	document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
	$(`screen-${name}`).classList.add("active");
	if (name === "welcome") {
		$("cleanBanner").classList.add("hidden");
		currentCleanables = null;
		currentTree = null;
		navigationStack = [];
		setTitle(null);
		yield* inSlot("stats", renderStatsWidget());
	}
	syncActiveRecent();
});

// --- Format size ---
function formatSize(bytes: number): string {
	if (bytes === 0) return "0 B";
	const units = ["B", "KB", "MB", "GB", "TB"];
	const i = Math.floor(Math.log(bytes) / Math.log(1024));
	const val = bytes / Math.pow(1024, i);
	const formatted = new Intl.NumberFormat(getLocale(), {
		maximumFractionDigits: i > 0 ? 1 : 0,
	}).format(val);
	return `${formatted} ${units[i]}`;
}

// --- Color palette for treemap ---
// Mid-tone hues that keep white labels readable on both light and dark backgrounds.
const COLORS = [
	"#7c6cf6", "#22a98f", "#ec7550", "#4888f0", "#d99a2b",
	"#dd5f97", "#2aa9bd", "#68a945", "#a46be0", "#7d8aa3",
];

function getColor(index: number): string {
	return COLORS[index % COLORS.length]!;
}

/** Folders get a palette color by rank, files a neutral tone. */
function swatch(entry: DirEntry, index: number): string {
	return entry.isDir ? getColor(index) : cssVar("--tm-file");
}

function cssVar(name: string): string {
	return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// --- Treemap rendering with Canvas ---
interface TreemapRect {
	x: number; y: number; w: number; h: number;
	entry: DirEntry;
	color: string;
}

function squarify(entries: DirEntry[], x: number, y: number, w: number, h: number): TreemapRect[] {
	const rects: TreemapRect[] = [];
	if (entries.length === 0 || w <= 0 || h <= 0) return rects;

	const totalSize = entries.reduce((s, e) => s + e.size, 0);
	if (totalSize === 0) return rects;

	const sorted = [...entries].sort((a, b) => b.size - a.size);
	layoutStrip(sorted, x, y, w, h, totalSize, rects);
	return rects;
}

function layoutStrip(
	entries: DirEntry[], x: number, y: number, w: number, h: number,
	totalSize: number, rects: TreemapRect[]
) {
	if (entries.length === 0 || totalSize === 0) return;
	if (entries.length === 1) {
		rects.push({ x, y, w, h, entry: entries[0]!, color: swatch(entries[0]!, rects.length) });
		return;
	}

	const horizontal = w >= h;
	let stripSize = 0;
	let stripEntries: DirEntry[] = [];
	let bestAspect = Infinity;

	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i]!;
		const testSize = stripSize + entry.size;
		const testEntries = [...stripEntries, entry];

		const stripFraction = testSize / totalSize;
		const stripDim = horizontal ? w * stripFraction : h * stripFraction;
		const otherDim = horizontal ? h : w;

		let worstAspect = 0;
		for (const e of testEntries) {
			const eFraction = e.size / testSize;
			const eDim = otherDim * eFraction;
			const aspect = Math.max(stripDim / eDim, eDim / stripDim);
			worstAspect = Math.max(worstAspect, aspect);
		}

		if (worstAspect <= bestAspect) {
			bestAspect = worstAspect;
			stripSize = testSize;
			stripEntries = testEntries;
		} else {
			break;
		}
	}

	const stripFraction = stripSize / totalSize;
	let cx = x, cy = y;

	if (horizontal) {
		const stripW = w * stripFraction;
		for (const e of stripEntries) {
			const eFraction = e.size / stripSize;
			const eH = h * eFraction;
			rects.push({ x: cx, y: cy, w: stripW, h: eH, entry: e, color: swatch(e, rects.length) });
			cy += eH;
		}
		const remaining = entries.slice(stripEntries.length);
		layoutStrip(remaining, x + stripW, y, w - stripW, h, totalSize - stripSize, rects);
	} else {
		const stripH = h * stripFraction;
		for (const e of stripEntries) {
			const eFraction = e.size / stripSize;
			const eW = w * eFraction;
			rects.push({ x: cx, y: cy, w: eW, h: stripH, entry: e, color: swatch(e, rects.length) });
			cx += eW;
		}
		const remaining = entries.slice(stripEntries.length);
		layoutStrip(remaining, x, y + stripH, w, h - stripH, totalSize - stripSize, rects);
	}
}

let treemapRects: TreemapRect[] = [];
let treemapAnimId: number | null = null;
let skipNextAnimation = false;
let hoveredRect: TreemapRect | null = null;

function drawTreemapFrame(ctx: CanvasRenderingContext2D, rects: TreemapRect[], alpha: number, _canvasW?: number, _canvasH?: number) {
	const gap = 1.5;
	const radius = 6;
	const label = cssVar("--tm-label");
	const sub = cssVar("--tm-sub");

	for (const r of rects) {
		const x = r.x + gap;
		const y = r.y + gap;
		const w = r.w - gap * 2;
		const h = r.h - gap * 2;
		if (w <= 0 || h <= 0) continue;
		const hovered = r === hoveredRect;

		ctx.globalAlpha = alpha;
		ctx.fillStyle = r.color;
		roundRect(ctx, x, y, w, h, Math.min(radius, w / 2, h / 2));
		ctx.fill();
		if (hovered) {
			ctx.fillStyle = "rgba(255,255,255,0.16)";
			ctx.fill();
			ctx.lineWidth = 2;
			ctx.strokeStyle = "rgba(255,255,255,0.85)";
			roundRect(ctx, x + 1, y + 1, w - 2, h - 2, Math.min(radius - 1, w / 2, h / 2));
			ctx.stroke();
		}

		if (w > 54 && h > 30) {
			ctx.fillStyle = label;
			ctx.font = "600 12px -apple-system, system-ui, sans-serif";
			ctx.fillText(truncateText(ctx, r.entry.name, w - 16), x + 8, y + 18);
			if (h > 46) {
				ctx.fillStyle = sub;
				ctx.font = "500 11px -apple-system, system-ui, sans-serif";
				ctx.fillText(formatSize(r.entry.size), x + 8, y + 33);
			}
		}
	}
	ctx.globalAlpha = 1;
}

/** Repaint in place (hover changes, theme switches) without the enter animation. */
function redrawTreemap() {
	const canvas = document.getElementById("treemapCanvas") as HTMLCanvasElement;
	const ctx = canvas.getContext("2d")!;
	const dpr = window.devicePixelRatio || 1;
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	ctx.clearRect(0, 0, canvas.width, canvas.height);
	drawTreemapFrame(ctx, treemapRects, 1);
}

function renderTreemap(entries: DirEntry[]) {
	const canvas = document.getElementById("treemapCanvas") as HTMLCanvasElement;
	const container = document.getElementById("vizContainer")!;
	const rect = container.getBoundingClientRect();
	const dpr = window.devicePixelRatio || 1;

	const prevRects = [...treemapRects];
	const shouldAnimate = !skipNextAnimation && prevRects.length > 0;
	skipNextAnimation = false;

	let prevOffscreen: OffscreenCanvas | null = null;
	if (shouldAnimate && canvas.width > 0 && canvas.height > 0) {
		prevOffscreen = new OffscreenCanvas(canvas.width, canvas.height);
		const offCtx = prevOffscreen.getContext("2d")!;
		offCtx.drawImage(canvas, 0, 0);
	}

	canvas.width = rect.width * dpr;
	canvas.height = rect.height * dpr;
	canvas.style.width = rect.width + "px";
	canvas.style.height = rect.height + "px";

	const ctx = canvas.getContext("2d")!;

	const topEntries = entries.filter((e) => e.size > 0).slice(0, 40);
	hoveredRect = null;
	treemapRects = squarify(topEntries, 2, 2, rect.width - 4, rect.height - 4);

	if (!shouldAnimate) {
		ctx.scale(dpr, dpr);
		ctx.clearRect(0, 0, rect.width, rect.height);
		drawTreemapFrame(ctx, treemapRects, 1, rect.width, rect.height);
		return;
	}

	if (treemapAnimId) cancelAnimationFrame(treemapAnimId);
	const duration = 250;
	const start = performance.now();

	function animateFrame(now: number) {
		const elapsed = now - start;
		const t = Math.min(elapsed / duration, 1);
		const ease = 1 - Math.pow(1 - t, 3);

		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, canvas.width, canvas.height);

		if (prevOffscreen) {
			ctx.globalAlpha = 1 - ease;
			ctx.drawImage(prevOffscreen, 0, 0, prevOffscreen.width, prevOffscreen.height, 0, 0, canvas.width, canvas.height);
			ctx.globalAlpha = 1;
		}

		ctx.save();
		ctx.scale(dpr, dpr);
		const scale = 0.97 + 0.03 * ease;
		const cx = rect.width / 2;
		const cy = rect.height / 2;
		ctx.translate(cx, cy);
		ctx.scale(scale, scale);
		ctx.translate(-cx, -cy);
		drawTreemapFrame(ctx, treemapRects, ease, rect.width, rect.height);
		ctx.restore();

		if (t < 1) {
			treemapAnimId = requestAnimationFrame(animateFrame);
		} else {
			treemapAnimId = null;
			ctx.setTransform(1, 0, 0, 1, 0, 0);
			ctx.clearRect(0, 0, canvas.width, canvas.height);
			ctx.scale(dpr, dpr);
			drawTreemapFrame(ctx, treemapRects, 1, rect.width, rect.height);
		}
	}

	treemapAnimId = requestAnimationFrame(animateFrame);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number | [number, number, number, number]) {
	const [tl, tr, br, bl] = typeof r === "number" ? [r, r, r, r] : r;
	ctx.beginPath();
	ctx.moveTo(x + tl, y);
	ctx.lineTo(x + w - tr, y);
	ctx.quadraticCurveTo(x + w, y, x + w, y + tr);
	ctx.lineTo(x + w, y + h - br);
	ctx.quadraticCurveTo(x + w, y + h, x + w - br, y + h);
	ctx.lineTo(x + bl, y + h);
	ctx.quadraticCurveTo(x, y + h, x, y + h - bl);
	ctx.lineTo(x, y + tl);
	ctx.quadraticCurveTo(x, y, x + tl, y);
	ctx.closePath();
}

function truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
	if (ctx.measureText(text).width <= maxWidth) return text;
	let t = text;
	while (t.length > 1 && ctx.measureText(t + "…").width > maxWidth) t = t.slice(0, -1);
	return t + "…";
}

// --- Treemap tooltip ---
const tooltip = document.createElement("div");
tooltip.className = "treemap-tooltip hidden";
tooltip.innerHTML = `<div class="tt-name"></div><div class="tt-size"></div>`;
document.getElementById("vizContainer")!.appendChild(tooltip);

const treemapCanvas = document.getElementById("treemapCanvas") as HTMLCanvasElement;
treemapCanvas.addEventListener("mousemove", (e) => {
	const rect = treemapCanvas.getBoundingClientRect();
	const mx = e.clientX - rect.left;
	const my = e.clientY - rect.top;
	const hit = treemapRects.find((r) => mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h);
	if (hit !== hoveredRect) {
		hoveredRect = hit ?? null;
		if (!treemapAnimId) redrawTreemap();
	}
	if (hit) {
		tooltip.classList.remove("hidden");
		tooltip.querySelector(".tt-name")!.textContent = hit.entry.name;
		tooltip.querySelector(".tt-size")!.textContent = formatSize(hit.entry.size);
		const tx = Math.min(e.clientX - rect.left + 14, rect.width - tooltip.offsetWidth - 8);
		const ty = Math.min(e.clientY - rect.top + 14, rect.height - tooltip.offsetHeight - 8);
		tooltip.style.left = tx + "px";
		tooltip.style.top = ty + "px";
	} else {
		tooltip.classList.add("hidden");
	}
});

treemapCanvas.addEventListener("mouseleave", () => {
	tooltip.classList.add("hidden");
	if (hoveredRect) {
		hoveredRect = null;
		if (!treemapAnimId) redrawTreemap();
	}
});

// Drill down into a directory, loading its children first if they are not cached yet.
const navigateInto = Effect.fn("navigateInto")(
	function* (entry: DirEntry) {
		if (!entry.children || entry.children.length === 0) {
			const backend = yield* Backend;
			const res = yield* backend.getChildren({ dirPath: entry.path });
			if (res && res.children && res.children.length > 0) {
				entry.children = res.children;
				entry.size = res.children.reduce((s: number, c: DirEntry) => s + c.size, 0);
			} else {
				// Summed but not explored (node_modules, hidden folders, beyond max depth): show its details
				yield* inSlot("infoPanel", openInfoPanel(entry.path, entry.size));
				return;
			}
		}
		navigationStack.push(entry);
		renderResults(entry);
	},
	Effect.catchTag("BackendError", () => Effect.void),
);

treemapCanvas.addEventListener("click", (e) => {
	const rect = treemapCanvas.getBoundingClientRect();
	const mx = e.clientX - rect.left;
	const my = e.clientY - rect.top;
	const hit = treemapRects.find((r) => mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h);
	if (hit && hit.entry.isDir) {
		run(navigateInto(hit.entry));
	}
});

// --- Render results ---
const ICON = (id: string, cls = "") => `<svg class="icon ${cls}"><use href="#i-${id}" /></svg>`;

function renderBreadcrumb() {
	const nav = $("breadcrumb");
	nav.innerHTML = "";
	navigationStack.forEach((entry, i) => {
		if (i > 0) nav.insertAdjacentHTML("beforeend", ICON("chevron", "breadcrumb-sep"));
		const isCurrent = i === navigationStack.length - 1;
		const crumb = document.createElement(isCurrent ? "span" : "button");
		crumb.className = "breadcrumb-item" + (isCurrent ? " current" : "");
		crumb.textContent = entry.name;
		crumb.title = entry.path;
		if (!isCurrent) {
			crumb.addEventListener("click", () => {
				navigationStack = navigationStack.slice(0, i + 1);
				renderResults(navigationStack[navigationStack.length - 1]!);
			});
		}
		nav.appendChild(crumb);
	});
	// Keep the current folder in view when the path is deep
	nav.scrollLeft = nav.scrollWidth;
}

function renderResults(entry: DirEntry) {
	$("totalSize").textContent = formatSize(entry.size);
	setTitle(entry.path);
	renderBreadcrumb();

	const children = (entry.children || []).filter((c) => c.size > 0);
	renderTreemap(children);
	renderDirList(children, entry.size);
	updateCleanBanner();
}

// --- Directory list (keyboard navigable) ---
let listEntries: DirEntry[] = [];
let selectedIndex = -1;

function renderDirList(entries: DirEntry[], parentSize: number) {
	const list = $("dirList");
	const tr = t();
	list.innerHTML = "";
	listEntries = entries;
	selectedIndex = -1;
	list.scrollTop = 0;

	entries.forEach((entry, index) => {
		const pct = parentSize > 0 ? (entry.size / parentSize) * 100 : 0;
		const item = document.createElement("div");
		item.className = "dir-item" + (entry.isDir ? " is-dir" : "");
		item.setAttribute("role", "option");
		item.title = entry.path;
		item.style.setProperty("--swatch", swatch(entry, index));
		item.innerHTML = `
			<div class="dir-item-icon">${entry.isDir ? ICON("folder", "is-dir") : ICON("file", "is-file")}</div>
			<div class="dir-item-name">${escapeHtml(entry.name)}</div>
			${entry.children?.length ? ICON("chevron", "dir-item-chevron") : ""}
			<div class="dir-item-bar"><div class="dir-item-bar-fill" style="width:${pct}%"></div></div>
			<div class="dir-item-pct">${pct >= 1 ? Math.round(pct) : "<1"}%</div>
			<div class="dir-item-size">${formatSize(entry.size)}</div>
			<div class="dir-item-actions">
				<button class="icon-btn" data-action="info" title="${escapeAttr(tr.showInfo)} (Space)">${ICON("info")}</button>
				<button class="icon-btn" data-action="reveal" title="${escapeAttr(tr.revealInFinder)}">${ICON("reveal")}</button>
				<button class="icon-btn icon-btn-danger" data-action="delete" title="${escapeAttr(tr.deleteButton)} (⌘⌫)">${ICON("trash")}</button>
			</div>
		`;
		item.addEventListener("click", (e) => {
			const action = (e.target as HTMLElement).closest<HTMLElement>("[data-action]")?.dataset.action;
			selectRow(index);
			if (action === "info") run(inSlot("infoPanel", openInfoPanel(entry.path, entry.size)));
			else if (action === "reveal") revealPath(entry.path);
			else if (action === "delete") promptDelete(entry);
			else if (entry.isDir) run(navigateInto(entry));
		});
		list.appendChild(item);
	});
}

function selectRow(index: number) {
	const rows = $("dirList").children;
	rows[selectedIndex]?.classList.remove("selected");
	selectedIndex = Math.max(0, Math.min(index, listEntries.length - 1));
	const row = rows[selectedIndex];
	row?.classList.add("selected");
	row?.scrollIntoView({ block: "nearest" });
}

$("dirList").addEventListener("keydown", (e) => {
	if (listEntries.length === 0) return;
	const entry = listEntries[selectedIndex];
	if (e.key === "ArrowDown" || e.key === "ArrowUp") {
		e.preventDefault();
		selectRow(selectedIndex < 0 ? 0 : selectedIndex + (e.key === "ArrowDown" ? 1 : -1));
	} else if ((e.key === "Enter" || e.key === "ArrowRight") && entry?.isDir) {
		e.preventDefault();
		run(navigateInto(entry));
	} else if ((e.key === " " || e.key === "i") && entry) {
		e.preventDefault();
		run(inSlot("infoPanel", openInfoPanel(entry.path, entry.size)));
	} else if ((e.key === "Delete" || (e.key === "Backspace" && e.metaKey)) && entry) {
		e.preventDefault();
		e.stopPropagation();
		promptDelete(entry);
	}
});

function revealPath(path: string) {
	run(Backend.use((backend) => backend.revealInFinder({ filePath: path })).pipe(logFailure("[fe] revealInFinder error:")));
}

/** Ask before deleting a single entry (moved to Trash or deleted, per settings). */
function promptDelete(entry: { path: string; name: string; size: number }) {
	const tr = t();
	pendingDeletePath = entry.path;
	pendingDeleteSize = entry.size;
	const isTrash = settingDeleteMode.value === "trash";
	$("deleteModalTitle").textContent = isTrash ? tr.moveToTrash : tr.deleteConfirmTitle;
	$("deleteMessage").textContent = isTrash
		? tr.deleteConfirmMessageTrash(entry.name, formatSize(entry.size))
		: tr.deleteConfirmMessage(entry.name, formatSize(entry.size));
	$("btnConfirmDelete").textContent = isTrash ? tr.moveToTrash : tr.deleteButton;
	openModal("modal-delete");
}

function escapeHtml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escapeAttr(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// --- Smart Clean ---
const detectAndShowCleanables = Effect.fn("detectAndShowCleanables")(
	function* (rootPath: string, useCache: boolean = true) {
		const banner = $("cleanBanner");
		showCleanCallout("analyzing");

		const backend = yield* Backend;

		// Try cached cleanables first (only when opening from cache, not after a new scan)
		if (useCache) {
			const cached = yield* backend.getCachedCleanables({ rootPath });
			if (cached?.found && cached.cleanables && cached.cleanables.items.length > 0) {
				currentCleanables = cached.cleanables;
				cleanableSelected = new Set(cached.cleanables.items.map((i) => i.path));
				updateCleanBanner();
				return;
			}
		}

		const result = yield* backend.detectCleanables({ rootPath });
		if (!result || result.items.length === 0) {
			banner.classList.add("hidden");
			currentCleanables = null;
			// Save empty result to cache so we don't re-scan next time
			yield* backend.saveCachedCleanables({ rootPath, cleanables: { items: [], totalSize: 0 } });
			return;
		}
		currentCleanables = result;
		cleanableSelected = new Set(result.items.map((i) => i.path));
		updateCleanBanner();
		// Save to cache for next time
		yield* backend.saveCachedCleanables({ rootPath, cleanables: result });
	},
	Effect.catchTag("BackendError", (e) =>
		Effect.gen(function* () {
			yield* Effect.logError("[cleanables] detection error:", e.cause);
			$("cleanBanner").classList.add("hidden");
			currentCleanables = null;
		}),
	),
);

const checkEnvsecAvailable = Effect.fn("checkEnvsecAvailable")(
	function* () {
		const backend = yield* Backend;
		const res = yield* backend.checkEnvsecAvailable({});
		envsecAvailable = res?.available ?? false;
		renderCleanList(); // re-render with updated button states
	},
	logFailure("[cleanables] checkEnvsecAvailable error:"),
);

const openCleanModal = Effect.fn("openCleanModal")(function* () {
	const scoped = getScopedCleanables();
	if (!scoped || scoped.items.length === 0) return;
	const modal = $("modal-clean");

	$("cleanTotalBadge").textContent = formatSize(scoped.totalSize);
	// Pre-select only low/medium risk items; high risk unchecked by default
	cleanableSelected = new Set(scoped.items.filter((i) => i.risk !== "high").map((i) => i.path));
	activeCleanFilters = new Set(); // reset filters

	// Check envsec availability (async, updates buttons after)
	const hasEnvFiles = scoped.items.some((i) => i.category === "secrets" && i.folderName.startsWith(".env"));
	if (hasEnvFiles && envsecAvailable === null) {
		yield* background(checkEnvsecAvailable());
	}

	// Hide envsec form if open from previous session
	$("envsecImportForm").classList.add("hidden");

	buildCleanFilters();
	renderCleanList();

	(document.getElementById("cleanSelectAll") as HTMLInputElement).checked = true;
	updateCleanSelection();
	renderRiskLegend();
	openModal("modal-clean");
});

function buildCleanFilters() {
	const container = $("cleanFilters");
	container.innerHTML = "";
	const scoped = getScopedCleanables();
	if (!scoped) return;

	// Collect unique tags: group by projectType → set of folderNames
	const tagMap = new Map<string, Set<string>>();
	for (const item of scoped.items) {
		if (!tagMap.has(item.projectType)) tagMap.set(item.projectType, new Set());
		tagMap.get(item.projectType)!.add(item.folderName);
	}

	// "All" chip
	const allChip = document.createElement("button");
	allChip.className = "clean-filter-chip chip-all active";
	allChip.textContent = t().filterAll;
	allChip.addEventListener("click", () => {
		activeCleanFilters.clear();
		syncFilterChipStates();
		renderCleanList();
	});
	container.appendChild(allChip);

	// One chip per unique folderName, grouped visually by projectType
	for (const [projectType, folderNames] of tagMap) {
		const group = document.createElement("span");
		group.className = "clean-filter-group" + (projectType === "Secrets" ? " clean-filter-group-secrets" : "");

		const label = document.createElement("span");
		label.className = "clean-filter-group-label";
		label.textContent = projectType + ":";
		group.appendChild(label);

		// For Secrets group, show a single aggregated chip instead of one per file
		if (projectType === "Secrets") {
			const allKeys = [...folderNames].map((fn) => `${projectType}|${fn}`);
			const chip = document.createElement("button");
			chip.className = "clean-filter-chip chip-secrets";
			chip.textContent = `⚠ ${t().sensitiveDataFound} (${folderNames.size})`;
			chip.dataset.filterKey = allKeys.join(",");
			chip.addEventListener("click", () => {
				const anyActive = allKeys.some((k) => activeCleanFilters.has(k));
				for (const k of allKeys) {
					if (anyActive) activeCleanFilters.delete(k);
					else activeCleanFilters.add(k);
				}
				syncFilterChipStates();
				renderCleanList();
			});
			group.appendChild(chip);
			container.appendChild(group);
			continue;
		}

		for (const folderName of folderNames) {
			const filterKey = `${projectType}|${folderName}`;
			const chip = document.createElement("button");
			chip.className = "clean-filter-chip";
			chip.textContent = `${folderName}`;
			chip.dataset.filterKey = filterKey;
			chip.addEventListener("click", () => {
				if (activeCleanFilters.has(filterKey)) {
					activeCleanFilters.delete(filterKey);
				} else {
					activeCleanFilters.add(filterKey);
				}
				syncFilterChipStates();
				renderCleanList();
			});
			group.appendChild(chip);
		}
		container.appendChild(group);
	}
}

function syncFilterChipStates() {
	const container = $("cleanFilters");
	const allChip = container.querySelector(".chip-all") as HTMLElement;
	if (allChip) {
		allChip.classList.toggle("active", activeCleanFilters.size === 0);
	}
	container.querySelectorAll<HTMLElement>(".clean-filter-chip:not(.chip-all)").forEach((chip) => {
		const key = chip.dataset.filterKey || "";
		// Aggregated secrets chip: active if any of its keys are active
		if (key.includes(",")) {
			const keys = key.split(",");
			chip.classList.toggle("active", keys.some((k) => activeCleanFilters.has(k)));
		} else {
			chip.classList.toggle("active", activeCleanFilters.has(key));
		}
	});
}

function getFilteredCleanItems(): CleanableItem[] {
	const scoped = getScopedCleanables();
	if (!scoped) return [];
	if (activeCleanFilters.size === 0) return scoped.items;
	return scoped.items.filter((i) => activeCleanFilters.has(`${i.projectType}|${i.folderName}`));
}

/** Path of `p` relative to the scanned root, prefixed with the root's name (e.g. "Developer/storefront"). */
function displayPath(p: string): string {
	const root = currentTree?.path;
	if (!root || !p.startsWith(root)) return p;
	const rootName = root.split("/").pop() || root;
	return (rootName + p.slice(root.length)).replace(/\/$/, "");
}

const RISK_LABEL = (risk: CleanableItem["risk"]) => (risk === "high" ? t().riskHigh : risk === "medium" ? t().riskMedium : t().riskLow);

function renderRiskLegend() {
	$("riskLegend").innerHTML = (["low", "medium", "high"] as const)
		.map((risk) => `<span><i class="risk-dot risk-${risk}"></i>${escapeHtml(RISK_LABEL(risk))}</span>`)
		.join("");
}

function renderCleanList() {
	const list = $("cleanList");
	const tr = t();
	list.innerHTML = "";
	const items = getFilteredCleanItems();

	// Deseleziona gli elementi non visibili
	if (getScopedCleanables() && activeCleanFilters.size > 0) {
		const visiblePaths = new Set(items.map((i) => i.path));
		for (const path of [...cleanableSelected]) {
			if (!visiblePaths.has(path)) {
				cleanableSelected.delete(path);
			}
		}
	}

	for (const item of items) {
		const row = document.createElement("label");
		row.className = `clean-item clean-risk-${item.risk}`;
		const isChecked = cleanableSelected.has(item.path);
		const isSecret = item.note === "sensitiveDataFound";
		const note = item.note && !isSecret ? item.note : "";
		const isEnvFile = item.category === "secrets" && item.folderName.startsWith(".env");
		const envsecDisabled = isEnvFile && !envsecAvailable;
		const projectName = item.projectPath.split("/").pop() || item.projectPath;
		row.title = note;
		row.innerHTML = `
			<input type="checkbox" ${isChecked ? "checked" : ""} data-path="${escapeAttr(item.path)}" />
			<i class="risk-dot" title="${escapeAttr(RISK_LABEL(item.risk))}"></i>
			<div class="clean-item-info">
				<div class="clean-item-title">
					<span class="clean-item-project">${escapeHtml(projectName)}</span>
					<span class="clean-item-folder">${escapeHtml(item.folderName)}</span>
				</div>
				${
					isSecret
						? `<div class="clean-item-warning">${ICON("alert")}${escapeHtml(tr.sensitiveDataFound)}</div>`
						: `<div class="clean-item-path">\u200E${escapeHtml(displayPath(item.projectPath))}\u200E</div>`
				}
			</div>
			<div class="clean-item-type${item.category === "secrets" ? " clean-item-type-secrets" : ""}">${escapeHtml(item.projectType)}</div>
			<div class="clean-item-size">${formatSize(item.size)}</div>
			<div class="clean-item-actions">
				${
					isEnvFile
						? `<button class="icon-btn btn-envsec" ${envsecDisabled ? "disabled" : ""} title="${escapeAttr(envsecDisabled ? tr.envsecNotAvailable : tr.importToEnvsec)}">${ICON("lock")}</button>`
						: ""
				}
				<button class="icon-btn btn-reveal" title="${escapeAttr(tr.revealInFinder)}">${ICON("reveal")}</button>
			</div>
		`;
		const cb = row.querySelector("input")!;
		cb.addEventListener("change", () => {
			if (cb.checked) {
				cleanableSelected.add(item.path);
			} else {
				cleanableSelected.delete(item.path);
			}
			updateCleanSelection();
		});
		row.querySelector(".btn-reveal")!.addEventListener("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			revealPath(item.path);
		});
		const envsecBtn = row.querySelector<HTMLButtonElement>(".btn-envsec");
		if (envsecBtn && !envsecBtn.disabled) {
			envsecBtn.addEventListener("click", (e) => {
				e.preventDefault();
				e.stopPropagation();
				openEnvsecImportForm(item.path, item.projectPath, item.folderName, item.size);
			});
		}
		list.appendChild(row);
	}
	updateCleanSelection();
}

function updateCleanSelection() {
	const scoped = getScopedCleanables();
	if (!scoped) return;
	const visibleItems = getFilteredCleanItems();
	const selectedItems = visibleItems.filter((i) => cleanableSelected.has(i.path));
	const totalSelected = selectedItems.reduce((s, i) => s + i.size, 0);
	const count = selectedItems.length;

	$("cleanSelectedInfo").textContent = `${t().cleanSelected(count)} · ${formatSize(totalSelected)}`;
	const btn = $("btnConfirmClean") as HTMLButtonElement;
	btn.disabled = count === 0;
	$("btnConfirmCleanText").textContent = count > 0 ? t().cleanSelectedWithSize(formatSize(totalSelected)) : t().cleanSelectedWithSize("");

	const selectAll = document.getElementById("cleanSelectAll") as HTMLInputElement;
	const visibleSelected = visibleItems.filter((i) => cleanableSelected.has(i.path)).length;
	selectAll.checked = visibleItems.length > 0 && visibleSelected === visibleItems.length;
	selectAll.indeterminate = visibleSelected > 0 && visibleSelected < visibleItems.length;
}

// --- Envsec import form ---
let pendingEnvsecPath: string | null = null;
let pendingEnvsecSize: number = 0;

function openEnvsecImportForm(filePath: string, projectPath: string, fileName: string, fileSize: number) {
	pendingEnvsecPath = filePath;
	pendingEnvsecSize = fileSize;
	const form = $("envsecImportForm");
	$("envsecImportFile").textContent = `${projectPath}/${fileName}`;
	// Derive default context
	const projectDir = projectPath.split("/").pop() || "project";
	const envSuffix = fileName.replace(/^\.env\.?/, "").toLowerCase() || "dev";
	const contextInput = $("envsecContextInput") as HTMLInputElement;
	contextInput.value = `${projectDir}.${envSuffix}`;
	form.classList.remove("hidden");
	contextInput.focus();
	contextInput.select();
}

function closeEnvsecImportForm() {
	$("envsecImportForm").classList.add("hidden");
	pendingEnvsecPath = null;
	pendingEnvsecSize = 0;
}

// Record freed space in the stats history (not awaited, like before).
const recordDeletion = (freedBytes: number, deleteCount: number) =>
	background(
		Backend.use((backend) => backend.recordDeletion({ freedBytes, deleteCount })).pipe(logFailure("[fe] recordDeletion error:")),
	);

const confirmEnvsecImport = Effect.fn("confirmEnvsecImport")(function* () {
	if (!pendingEnvsecPath) return;
	const context = ($("envsecContextInput") as HTMLInputElement).value.trim();
	if (!context) return;
	const filePath = pendingEnvsecPath;
	const fileSize = pendingEnvsecSize;
	const confirmBtn = $("btnEnvsecConfirm") as HTMLButtonElement;
	confirmBtn.disabled = true;
	$("btnEnvsecConfirmText").textContent = t().envsecImporting;
	yield* Effect.gen(function* () {
		const backend = yield* Backend;
		const result = yield* backend.importEnvToEnvsec({ filePath, context });
		if (result?.success) {
			closeEnvsecImportForm();
			yield* showFreedToast(fileSize);
			totalFreedBytes += fileSize;
			yield* recordDeletion(fileSize, 1);
			// Refresh the view
			if (currentTree) {
				yield* loadTreeFromCache(currentTree.path, true);
				yield* background(detectAndShowCleanables(currentTree.path, false));
			}
			$("modal-clean").classList.add("hidden");
		} else {
			alert(t().envsecImportError + (result?.error ? `: ${result.error}` : ""));
		}
	}).pipe(
		Effect.catchTag("BackendError", () => Effect.sync(() => alert(t().envsecImportError))),
		Effect.ensuring(
			Effect.sync(() => {
				confirmBtn.disabled = false;
				$("btnEnvsecConfirmText").textContent = t().envsecConfirmImport;
			}),
		),
	);
});

$("btnEnvsecCancel").addEventListener("click", closeEnvsecImportForm);
$("btnEnvsecConfirm").addEventListener("click", () => run(confirmEnvsecImport()));
$("envsecContextInput").addEventListener("keydown", (e) => {
	if (e.key === "Enter") run(confirmEnvsecImport());
	if (e.key === "Escape") closeEnvsecImportForm();
});

$("cleanSelectAll").addEventListener("change", () => {
	const checked = (document.getElementById("cleanSelectAll") as HTMLInputElement).checked;
	if (!getScopedCleanables()) return;
	const visibleItems = getFilteredCleanItems();
	const visiblePaths = new Set(visibleItems.map((i) => i.path));
	const checkboxes = $("cleanList").querySelectorAll<HTMLInputElement>("input[type='checkbox']");
	checkboxes.forEach((cb) => {
		cb.checked = checked;
		const path = cb.dataset.path;
		if (path && visiblePaths.has(path)) {
			if (checked) cleanableSelected.add(path);
			else cleanableSelected.delete(path);
		}
	});
	updateCleanSelection();
});

$("btnOpenClean").addEventListener("click", () => run(openCleanModal()));

$("btnCancelClean").addEventListener("click", () => closeModal("modal-clean"));

const confirmBatchClean = Effect.fn("confirmBatchClean")(
	function* () {
		if (cleanableSelected.size === 0) return;
		const paths = Array.from(cleanableSelected);
		const btn = $("btnConfirmClean") as HTMLButtonElement;
		btn.disabled = true;
		$("btnConfirmCleanText").textContent = t().cleaningInProgress;

		const backend = yield* Backend;
		const result = yield* backend.batchDelete({ paths });
		$("modal-clean").classList.add("hidden");

		if (result) {
			if (result.deletedSize > 0) {
				totalFreedBytes += result.deletedSize;
				yield* showFreedToast(result.deletedSize);
				yield* recordDeletion(result.deletedSize, result.deletedCount);
			}
			if (result.errors.length > 0) {
				yield* Effect.logError("[cleanables] batch delete errors:", result.errors);
			}
			if (currentTree) {
				yield* loadTreeFromCache(currentTree.path, true);
				yield* background(detectAndShowCleanables(currentTree.path, false));
			}
			yield* background(renderCacheList());
		}
	},
	Effect.catchTag("BackendError", (e) =>
		Effect.gen(function* () {
			yield* Effect.logError("[cleanables] batch delete error:", e.cause);
			$("modal-clean").classList.add("hidden");
		}),
	),
);

$("btnConfirmClean").addEventListener("click", () => run(confirmBatchClean()));

// --- Navigation ---
const navigateBack = Effect.fnUntraced(function* () {
	if (navigationStack.length > 1) {
		navigationStack.pop();
		renderResults(navigationStack[navigationStack.length - 1]!);
	} else {
		yield* goToWelcome();
	}
});

$("btnBack").addEventListener("click", () => run(navigateBack()));

// --- Scan ---
$("btnScan").addEventListener("click", () => {
	const dirPath = scanPathInput.value.trim();
	if (!dirPath) return;
	acList.classList.add("hidden");
	run(startScan(dirPath));
});

$("btnRescan").addEventListener("click", () => {
	const dirPath = navigationStack[0]?.path ?? scanPathInput.value.trim();
	if (dirPath) run(startScan(dirPath));
});

$("btnCancelScan").addEventListener("click", () => {
	run(cancelScan());
});

// --- Sidebar: recent scans ---
let cachedRoots: { rootPath: string; timestamp: number; size: number }[] = [];

function relativeTime(timestamp: number): string {
	const rtf = new Intl.RelativeTimeFormat(getLocale(), { numeric: "auto", style: "short" });
	const seconds = Math.round((timestamp - Date.now()) / 1000);
	const steps: [Intl.RelativeTimeFormatUnit, number][] = [["second", 60], ["minute", 60], ["hour", 24], ["day", 30], ["month", 12]];
	let value = seconds;
	for (const [unit, size] of steps) {
		if (Math.abs(value) < size) return unit === "second" ? rtf.format(0, "second") : rtf.format(value, unit);
		value = Math.round(value / size);
	}
	return rtf.format(value, "year");
}

const openCachedScan = Effect.fn("openCachedScan")(
	function* (path: string) {
		scanPathInput.value = path;
		yield* loadTreeFromCache(path, false);
		yield* background(detectAndShowCleanables(path));
	},
	Effect.catchTag("BackendError", (e) => Effect.logError("[fe] openCachedScan error:", e.cause)),
);

const deleteCacheEntry = Effect.fn("deleteCacheEntry")(
	function* (path: string) {
		const backend = yield* Backend;
		yield* backend.deleteCacheEntry({ rootPath: path });
		if (currentTree?.path === path) yield* goToWelcome();
		else yield* background(renderCacheList());
	},
	Effect.catchTag("BackendError", (e) => Effect.logError("[fe] deleteCacheEntry error:", e.cause)),
);

/** Highlight the sidebar entry of the scan on screen. */
function syncActiveRecent() {
	const active = isScanning ? $("scanTarget").textContent : (navigationStack[0]?.path ?? null);
	$("cacheList")
		.querySelectorAll<HTMLElement>(".recent-item")
		.forEach((item) => item.classList.toggle("active", item.dataset.path === active));
}

const renderCacheList: () => Effect.Effect<void, never, MainviewServices> = Effect.fn("renderCacheList")(
	function* () {
		const backend = yield* Backend;
		const result = yield* backend.getCacheList({});
		const tr = t();
		const list = $("cacheList");
		cachedRoots = result?.entries ?? [];
		list.innerHTML = "";
		$("recentEmpty").classList.toggle("hidden", cachedRoots.length > 0);
		const nameOf = (p: string) => p.replace(/\/$/, "").split("/").pop() || p;
		const names = cachedRoots.map((r) => nameOf(r.rootPath));
		for (const entry of cachedRoots) {
			const path = entry.rootPath.replace(/\/$/, "") || "/";
			const name = nameOf(path);
			// Same folder name twice: tell them apart by their parent
			const parent = names.filter((n) => n === name).length > 1 ? `${nameOf(path.slice(0, -name.length - 1))} · ` : "";
			const item = document.createElement("li");
			item.className = "recent-item";
			item.dataset.path = entry.rootPath;
			item.title = path;
			item.innerHTML = `
				<button class="recent-item-open" aria-label="${escapeAttr(path)}"></button>
				${ICON("folder")}
				<div class="recent-item-text">
					<span class="recent-item-name">${escapeHtml(name)}</span>
					<span class="recent-item-meta">${escapeHtml(parent)}${formatSize(entry.size)} · ${escapeHtml(relativeTime(entry.timestamp))}</span>
				</div>
				<div class="recent-item-actions">
					<button class="icon-btn" data-action="rescan" title="${escapeAttr(tr.rescanButton)}">${ICON("refresh")}</button>
					<button class="icon-btn icon-btn-danger" data-action="delete-cache" title="${escapeAttr(tr.removeCache)}">${ICON("close")}</button>
				</div>
			`;
			item.querySelector(".recent-item-open")!.addEventListener("click", () => run(openCachedScan(entry.rootPath)));
			item.querySelector("[data-action='rescan']")!.addEventListener("click", () => {
				scanPathInput.value = entry.rootPath;
				run(startScan(entry.rootPath));
			});
			item.querySelector("[data-action='delete-cache']")!.addEventListener("click", () => run(deleteCacheEntry(entry.rootPath)));
			list.appendChild(item);
		}
		syncActiveRecent();
	},
	Effect.catchTag("BackendError", (e) => Effect.logError("[fe] renderCacheList error:", e.cause)),
);

// --- Dialogs ---
// Initial focus is never a destructive button: Enter/Space must not delete by accident.
const MODAL_FOCUS = { "modal-delete": "btnCancelDelete", "modal-clean": "btnCancelClean", "modal-settings": "settingLang" } as const;

function openModal(id: "modal-clean" | "modal-delete" | "modal-settings") {
	$(id).classList.remove("hidden");
	$(MODAL_FOCUS[id]).focus({ preventScroll: true });
}

function closeModal(id: "modal-clean" | "modal-delete" | "modal-settings") {
	$(id).classList.add("hidden");
	if (id === "modal-delete") {
		pendingDeletePath = null;
		pendingDeleteSize = 0;
	}
	// Give keyboard navigation back to the list
	if (document.querySelector(".screen.active")?.id === "screen-results") $("dirList").focus({ preventScroll: true });
}

function openModalId(): "modal-clean" | "modal-delete" | "modal-settings" | null {
	for (const id of ["modal-delete", "modal-clean", "modal-settings"] as const) {
		if (!$(id).classList.contains("hidden")) return id;
	}
	return null;
}

document.querySelectorAll<HTMLElement>(".modal").forEach((modal) => {
	const id = modal.id as "modal-clean" | "modal-delete" | "modal-settings";
	modal.querySelector(".modal-backdrop")!.addEventListener("click", () => closeModal(id));
	modal.querySelectorAll("[data-close-modal]").forEach((btn) => btn.addEventListener("click", () => closeModal(id)));
});

// --- Delete modal ---
$("btnCancelDelete").addEventListener("click", () => closeModal("modal-delete"));

const confirmDelete = Effect.fn("confirmDelete")(
	function* () {
		if (!pendingDeletePath) return;
		const path = pendingDeletePath;
		const deletedSize = pendingDeleteSize;
		closeModal("modal-delete");

		const backend = yield* Backend;
		const result = yield* backend.deleteEntry({ entryPath: path });
		if (result && !result.success) {
			alert(t().deleteError + " " + (result.error || t().unknownError));
		} else {
			totalFreedBytes += deletedSize;
			yield* showFreedToast(deletedSize);
			yield* recordDeletion(deletedSize, 1);
			if (result?.rootPath) {
				yield* loadTreeFromCache(result.rootPath, true);
			}
			yield* background(renderCacheList());
		}
	},
	Effect.catchTag("BackendError", (e) => Effect.logError("[fe] deleteEntry error:", e.cause)),
);

$("btnConfirmDelete").addEventListener("click", () => run(confirmDelete()));

// --- Freed space toast ---
const showFreedToast = Effect.fnUntraced(function* (justFreed: number) {
	const toast = $("freedToast");
	const justEl = $("freedJust");
	const totalEl = $("freedTotal");
	const totalRow = $("freedTotalRow");

	justEl.textContent = formatSize(justFreed);
	if (totalFreedBytes > justFreed) {
		totalEl.textContent = formatSize(totalFreedBytes);
		totalRow.classList.remove("hidden");
	} else {
		totalRow.classList.add("hidden");
	}

	toast.classList.remove("hidden");
	toast.classList.remove("toast-exit");
	void toast.offsetWidth;
	toast.classList.add("toast-enter");

	// A new toast restarts the hide timer (and cancels a pending exit).
	yield* inSlot(
		"toast",
		Effect.gen(function* () {
			yield* Effect.sleep("3 seconds");
			toast.classList.remove("toast-enter");
			toast.classList.add("toast-exit");
			yield* Effect.sleep("300 millis");
			toast.classList.add("hidden");
		}),
	);
});

// --- Resize handler ---
window.addEventListener("resize", () => {
	if (currentTree && navigationStack.length > 0) {
		const current = navigationStack[navigationStack.length - 1]!;
		const children = (current.children || []).filter((c) => c.size > 0);
		skipNextAnimation = true;
		renderTreemap(children);
	}
	// Re-render stats chart on resize if on welcome screen
	const activeScreen = document.querySelector(".screen.active");
	if (activeScreen?.id === "screen-welcome" && !$("statsWidget").classList.contains("hidden")) {
		run(inSlot("stats", renderStatsWidget()));
	}
});

// --- Autocomplete ---
const acList = $("autocompleteList");
const btnScan = $("btnScan") as HTMLButtonElement;
let acIndex = -1;

function setPathError(message: string | null) {
	scanPathInput.parentElement!.classList.toggle("invalid", message !== null);
	$("scanPathError").textContent = message ?? "";
	$("scanPathError").classList.toggle("hidden", message === null);
}

const validatePath = Effect.fn("validatePath")(
	function* (dirPath: string) {
		if (!dirPath.trim()) {
			btnScan.disabled = true;
			setPathError(null);
			return;
		}
		const backend = yield* Backend;
		const result = yield* backend.validatePath({ dirPath: dirPath.trim() });
		btnScan.disabled = !result?.valid;
		setPathError(result?.valid ? null : t().dirNotFound);
	},
	Effect.catchTag("BackendError", (e) => Effect.logError("[autocomplete] validatePath error:", e.cause)),
);

const fetchSuggestions: (partial: string) => Effect.Effect<void, never, MainviewServices> = Effect.fn("fetchSuggestions")(
	function* (partial: string) {
		if (!partial || partial.length < 1) {
			acList.classList.add("hidden");
			return;
		}
		const backend = yield* Backend;
		const result = yield* backend.listDir({ partial });
		yield* Effect.log("[autocomplete] partial:", partial, "result:", result);
		if (!result || !result.suggestions || result.suggestions.length === 0) {
			acList.classList.add("hidden");
			return;
		}
		acIndex = -1;
		acList.innerHTML = "";
		for (const s of result.suggestions) {
			const item = document.createElement("div");
			item.className = "autocomplete-item";
			item.setAttribute("role", "option");
			item.innerHTML = `${ICON("folder")}<span>${escapeHtml(s)}</span>`;
			item.dataset.value = s;
			item.addEventListener("mousedown", (e) => {
				e.preventDefault();
				run(acceptSuggestion(s));
			});
			acList.appendChild(item);
		}
		acList.classList.remove("hidden");
	},
	Effect.catchTag("BackendError", (e) =>
		Effect.gen(function* () {
			yield* Effect.logError("[autocomplete] error:", e.cause);
			acList.classList.add("hidden");
		}),
	),
);

// Autocomplete and path validation each own a slot, so a newer request
// (debounced or immediate) supersedes an older one still in flight.
const suggest = (partial: string) => inSlot("autocomplete", fetchSuggestions(partial));
const validate = (dirPath: string) => inSlot("validatePath", validatePath(dirPath));

// Fill the input with a suggestion and look one level deeper.
const acceptSuggestion = Effect.fnUntraced(function* (suggestion: string) {
	scanPathInput.value = suggestion + "/";
	acList.classList.add("hidden");
	yield* suggest(suggestion + "/");
	yield* validate(suggestion + "/");
});

const inputHint = $("inputHint");

scanPathInput.addEventListener("input", () => {
	inputHint.style.display = scanPathInput.value ? "none" : "";
	run(
		Effect.gen(function* () {
			yield* debounced("autocomplete", "120 millis", Effect.suspend(() => fetchSuggestions(scanPathInput.value)));
			yield* debounced("validatePath", "250 millis", Effect.suspend(() => validatePath(scanPathInput.value)));
		}),
	);
});

scanPathInput.addEventListener("keydown", (e) => {
	const items = acList.querySelectorAll(".autocomplete-item");
	const isOpen = !acList.classList.contains("hidden") && items.length > 0;

	if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
		e.preventDefault();
		acList.classList.add("hidden");
		const dirPath = scanPathInput.value.trim();
		if (dirPath) {
			run(startScan(dirPath));
		}
		return;
	}

	if (e.key === "Enter") {
		if (isOpen && acIndex >= 0) {
			e.preventDefault();
			const selected = items[acIndex] as HTMLElement;
			run(acceptSuggestion(selected.dataset.value || ""));
		} else {
			acList.classList.add("hidden");
		}
		return;
	}

	if (!isOpen) return;

	if (e.key === "ArrowDown") {
		e.preventDefault();
		acIndex = Math.min(acIndex + 1, items.length - 1);
		updateAcActive(items);
	} else if (e.key === "ArrowUp") {
		e.preventDefault();
		acIndex = Math.max(acIndex - 1, 0);
		updateAcActive(items);
	} else if (e.key === "Escape") {
		acList.classList.add("hidden");
	} else if (e.key === "Tab" && acIndex >= 0) {
		e.preventDefault();
		const selected = items[acIndex] as HTMLElement;
		run(acceptSuggestion(selected.dataset.value || ""));
	}
});

function updateAcActive(items: NodeListOf<Element>) {
	items.forEach((el, i) => {
		el.classList.toggle("active", i === acIndex);
		if (i === acIndex) el.scrollIntoView({ block: "nearest" });
	});
}

scanPathInput.addEventListener("blur", () => {
	run(debounced("autocompleteHide", "150 millis", Effect.sync(() => acList.classList.add("hidden"))));
});

scanPathInput.addEventListener("focus", () => {
	if (scanPathInput.value) run(suggest(scanPathInput.value));
});

// --- Settings dialog ---
$("btnSettings").addEventListener("click", () => openModal("modal-settings"));

// --- Settings ---
const settingMaxCache = $("settingMaxCache") as HTMLInputElement;
const settingMaxDepth = $("settingMaxDepth") as HTMLInputElement;
const settingDeleteMode = $("settingDeleteMode") as HTMLSelectElement;
const settingLang = $("settingLang") as HTMLSelectElement;

const loadSettingsUI = Effect.fn("loadSettingsUI")(
	function* () {
		const backend = yield* Backend;
		const settings = yield* backend.getSettings({});
		if (settings) {
			settingMaxCache.value = String(settings.maxCacheEntries);
			settingMaxDepth.value = String(settings.maxDepth);
			settingDeleteMode.value = settings.deleteMode;
			syncDeleteModeControl();
		}
	},
	Effect.catchTag("BackendError", (e) => Effect.logError("[settings] load error:", e.cause)),
);

// Reads the inputs when it runs, i.e. after the debounce delay.
const saveSettings = Effect.fn("saveSettings")(
	function* () {
		const backend = yield* Backend;
		yield* backend.saveSettings({
			maxCacheEntries: Number(settingMaxCache.value) || 10,
			deleteMode: settingDeleteMode.value,
			maxDepth: Number(settingMaxDepth.value) || 10,
		});
	},
	Effect.catchTag("BackendError", (e) => Effect.logError("[settings] save error:", e.cause)),
);

function saveSettingsDebounced() {
	run(debounced("saveSettings", "400 millis", saveSettings()));
}

settingMaxCache.addEventListener("change", saveSettingsDebounced);
settingMaxCache.addEventListener("input", saveSettingsDebounced);
settingMaxDepth.addEventListener("change", saveSettingsDebounced);
settingMaxDepth.addEventListener("input", saveSettingsDebounced);
settingDeleteMode.addEventListener("change", saveSettingsDebounced);

function syncDeleteModeControl() {
	const mode = settingDeleteMode.value;
	$("deleteModeSegmented")
		.querySelectorAll<HTMLElement>("button")
		.forEach((btn) => btn.classList.toggle("active", btn.dataset.mode === mode));
	$("deleteModeHint").textContent = mode === "permanent" ? t().deleteModePermanentHint : t().deleteModeTrashHint;
}

$("deleteModeSegmented")
	.querySelectorAll<HTMLElement>("button")
	.forEach((btn) =>
		btn.addEventListener("click", () => {
			settingDeleteMode.value = btn.dataset.mode!;
			syncDeleteModeControl();
			saveSettingsDebounced();
		}),
	);

// --- Language selector ---
function populateLanguageSelector() {
	settingLang.innerHTML = "";
	for (const lang of getAvailableLanguages()) {
		const opt = document.createElement("option");
		opt.value = lang.code;
		opt.textContent = lang.label;
		settingLang.appendChild(opt);
	}
	settingLang.value = getLanguage();
}

settingLang.addEventListener("change", () => {
	setLanguage(settingLang.value);
	applyTranslations();
	// Re-render dynamic content
	run(renderCacheList());
});

// --- Apply all translations to static DOM elements ---
function applyTranslations() {
	const tr = t();
	document.documentElement.lang = getLanguage();

	// Sidebar
	$("btnNewScanText").textContent = tr.newScan;
	$("recentHeading").textContent = tr.recentScans;
	$("recentEmpty").textContent = tr.noRecentScans;
	$("btnSettingsText").textContent = tr.settingsTitle;
	$("statsWidgetTitle").textContent = tr.statsTitle;

	// Start
	$("startTitle").textContent = tr.startTitle;
	$("welcomeDesc").textContent = tr.welcomeDesc;
	$("scanPathLabel").textContent = tr.scanLabel;
	btnScan.textContent = tr.scanButton;
	$("quickPicksLabel").textContent = tr.quickPicks;

	// Scanning
	$("scanningText").textContent = tr.scanningText.replace(/\.{3}$/, "…");
	$("btnCancelScan").textContent = tr.cancelScan;

	// Results
	$("btnBack").title = tr.backTitle;
	$("breadcrumb").setAttribute("aria-label", tr.navigation);
	$("btnRescanText").textContent = tr.rescanButton;
	$("btnReveal").title = tr.revealInFinder;
	$("btnOpenClean").textContent = tr.cleanDetails;
	$("colName").textContent = tr.nameColumn;
	$("colSize").textContent = tr.size;

	// Settings
	$("settingsHeaderText").textContent = tr.settingsTitle;
	$("settingLangLabel").textContent = tr.language;
	$("settingMaxCacheLabel").textContent = tr.maxCache;
	$("maxCacheHint").textContent = tr.maxCacheHint;
	$("settingMaxDepthLabel").textContent = tr.scanDepth;
	$("scanDepthHint").textContent = tr.scanDepthHint;
	$("settingDeleteModeLabel").textContent = tr.deleteMode;
	$("optionTrash").textContent = tr.deleteModeTrash;
	$("optionPermanent").textContent = tr.deleteModePermanent;
	syncDeleteModeControl();

	// Delete dialog
	$("btnCancelDelete").textContent = tr.cancel;

	// Smart Clean
	$("cleanModalTitle").textContent = tr.smartCleanTitle;
	$("cleanModalDesc").textContent = tr.cleanModalDesc;
	$("cleanSelectAllLabel").textContent = tr.selectAll;
	$("btnCancelClean").textContent = tr.cancel;
	$("btnConfirmCleanText").textContent = tr.cleanSelectedWithSize("");
	renderRiskLegend();

	// envsec import
	$("envsecImportTitle").textContent = tr.envsecImportTitle;
	$("envsecContextLabel").textContent = tr.envsecContextPrompt;
	$("btnEnvsecCancel").textContent = tr.cancel;
	$("btnEnvsecConfirmText").textContent = tr.envsecConfirmImport;

	// Toast
	$("freedJustLabel").textContent = tr.freedJust;
	$("freedTotalLabel").textContent = tr.freedSessionTotal;

	// Inspector
	$("infoPanelClose").title = tr.closeEsc;
	$("infoPanelLoading").textContent = tr.loading;

	renderQuickPicks();
}

/** "Ingombro — <folder>" in the titlebar. */
function setTitle(path: string | null) {
	const name = path ? path.replace(/\/$/, "").split("/").pop() || path : null;
	$("titlebarTitle").textContent = name ? `Ingombro — ${name}` : "Ingombro";
}

// --- Start screen ---
$("btnNewScan").addEventListener("click", () => {
	if (isScanning) return;
	run(
		goToWelcome().pipe(
			Effect.andThen(
				Effect.sync(() => {
					scanPathInput.focus();
					scanPathInput.select();
				}),
			),
		),
	);
});

$("btnReveal").addEventListener("click", () => {
	const current = navigationStack[navigationStack.length - 1];
	if (current) revealPath(current.path);
});

// Common starting points, shown when they exist on this machine
const QUICK_PICKS = [
	{ path: "~", icon: "home" },
	{ path: "~/Desktop", icon: "folder" },
	{ path: "~/Documents", icon: "folder" },
	{ path: "~/Downloads", icon: "folder" },
	{ path: "~/Developer", icon: "folder" },
	{ path: "~/Movies", icon: "folder" },
];
let availableQuickPicks: string[] = [];

function renderQuickPicks() {
	const list = $("quickPicksList");
	list.innerHTML = "";
	for (const pick of QUICK_PICKS.filter((p) => availableQuickPicks.includes(p.path))) {
		const btn = document.createElement("button");
		btn.className = "quick-pick";
		btn.title = pick.path;
		btn.innerHTML = `${ICON(pick.icon)}<span>${escapeHtml(pick.path === "~" ? t().homeFolder : pick.path.slice(2))}</span>`;
		btn.addEventListener("click", () => {
			scanPathInput.value = pick.path;
			run(startScan(pick.path));
		});
		list.appendChild(btn);
	}
	$("quickPicks").classList.toggle("hidden", list.children.length === 0);
}

const loadQuickPicks = Effect.fn("loadQuickPicks")(function* () {
	const backend = yield* Backend;
	const valid = yield* Effect.forEach(
		QUICK_PICKS,
		(pick) =>
			backend.validatePath({ dirPath: pick.path }).pipe(
				Effect.map((r) => (r?.valid ? pick.path : null)),
				Effect.orElseSucceed(() => null),
			),
		{ concurrency: "unbounded" },
	);
	availableQuickPicks = valid.filter((p): p is string => p !== null);
	renderQuickPicks();
});

// Repaint canvases when the system switches between light and dark
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
	if (treemapRects.length) {
		const current = navigationStack[navigationStack.length - 1];
		if (current) {
			skipNextAnimation = true;
			renderTreemap((current.children || []).filter((c) => c.size > 0));
			renderDirList((current.children || []).filter((c) => c.size > 0), current.size);
		}
	}
	run(inSlot("stats", renderStatsWidget()));
});

// --- Info Panel ---
let infoPanelOpen = false;

// Runs in the "infoPanel" slot: opening cancels a pending close animation and
// any previous entry still loading.
// `knownSize` is the recursive size from the scan; entry info only sums a folder's direct files.
const openInfoPanel = Effect.fn("openInfoPanel")(function* (entryPath: string, knownSize?: number) {
	const panel = $("infoPanel");
	const backdrop = $("infoPanelBackdrop");
	const body = $("infoPanelBody");
	const title = $("infoPanelTitle");

	title.textContent = entryPath.split("/").pop() || entryPath;
	body.innerHTML = `<div class="inspector-loading">${t().loading}</div>`;

	panel.classList.remove("hidden");
	backdrop.classList.remove("hidden");
	void panel.offsetWidth;
	panel.classList.add("visible");
	backdrop.classList.add("visible");
	infoPanelOpen = true;

	const backend = yield* Backend;
	yield* backend.getEntryInfo({ entryPath }).pipe(
		Effect.tap((info) =>
			Effect.sync(() => {
				// The Bun side may answer with an `{ error }` object instead of an EntryInfo.
				if (!info || (info as EntryInfo & { error?: unknown }).error) {
					body.innerHTML = `<div class="inspector-loading">${t().loadError}</div>`;
					title.textContent = t().errorTitle;
					return;
				}
				title.textContent = info.name;
				renderInfoPanelContent(info.isDir && knownSize !== undefined ? { ...info, size: knownSize } : info);
			}),
		),
		Effect.catchTag("BackendError", () =>
			Effect.sync(() => {
				body.innerHTML = `<div class="inspector-loading">${t().connectionError}</div>`;
			}),
		),
	);
});

function closeInfoPanel() {
	const panel = $("infoPanel");
	const backdrop = $("infoPanelBackdrop");
	panel.classList.remove("visible");
	backdrop.classList.remove("visible");
	infoPanelOpen = false;
	run(
		debounced(
			"infoPanel",
			"260 millis",
			Effect.sync(() => {
				panel.classList.add("hidden");
				backdrop.classList.add("hidden");
			}),
		),
	);
}

function formatDate(ms: number): string {
	const d = new Date(ms);
	return d.toLocaleDateString(getLocale(), { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function renderInfoPanelContent(info: EntryInfo) {
	const body = $("infoPanelBody");
	const tr = t();
	const row = (label: string, value: string) =>
		`<div class="info-row"><span class="info-row-label">${escapeHtml(label)}</span><span class="info-row-value">${escapeHtml(value)}</span></div>`;
	const stat = (value: string, label: string) =>
		`<div class="info-stat"><div class="info-stat-value">${escapeHtml(value)}</div><div class="info-stat-label">${escapeHtml(label)}</div></div>`;
	const section = (title: string, content: string) =>
		`<div class="info-section"><div class="info-section-title">${escapeHtml(title)}</div>${content}</div>`;
	const number = new Intl.NumberFormat(getLocale());

	$("infoPanelIcon").innerHTML = ICON(info.isDir ? "folder" : "file");
	let html = "";

	if (info.isDir) {
		html += `<div class="info-stats">${stat(formatSize(info.size), tr.size)}${stat(number.format(info.fileCount ?? 0), tr.files)}${stat(number.format(info.dirCount ?? 0), tr.folders)}</div>`;
		html += section(tr.details, row(tr.lastModified, formatDate(info.modifiedAt)) + row(tr.created, formatDate(info.createdAt)));
		if (info.largestFile) html += section(tr.largestFile, row(info.largestFile.name, formatSize(info.largestFile.size)));
		if (info.newestFile) html += section(tr.newestModified, row(info.newestFile.name, formatDate(info.newestFile.modifiedAt)));
		if (info.typeDistribution && info.typeDistribution.length > 0) {
			const typeLabelMap: Record<string, string> = {
				code: tr.typeCode, images: tr.typeImages, documents: tr.typeDocuments,
				config: tr.typeConfig, styles: tr.typeStyles, html: tr.typeHTML, other: tr.typeOther,
			};
			const bar = info.typeDistribution.map((td) => `<div style="width:${td.percentage}%;background:${td.color}"></div>`).join("");
			const legend = info.typeDistribution
				.map(
					(td) =>
						`<span class="info-type-legend-item"><span class="info-type-dot" style="background:${td.color}"></span>${escapeHtml(typeLabelMap[td.label] || td.label)} ${td.percentage}%</span>`,
				)
				.join("");
			html += section(tr.typeDistribution, `<div class="info-type-bar">${bar}</div><div class="info-type-legend">${legend}</div>`);
		}
	} else {
		html += `<div class="info-stats">${stat(formatSize(info.size), tr.size)}${info.extension ? stat(info.extension, "") : ""}</div>`;
		html += section(tr.details, row(tr.lastModified, formatDate(info.modifiedAt)) + row(tr.created, formatDate(info.createdAt)));
		if (info.previewType === "text" && info.textPreview) {
			html += section(tr.preview, `<pre class="info-text-preview">${escapeHtml(info.textPreview)}</pre>`);
		} else if (info.previewType === "image") {
			html += section(tr.preview, `<img class="info-image-preview" src="file://${encodeURI(info.path)}" alt="${escapeAttr(info.name)}" />`);
		}
	}

	html += section(tr.path, `<div class="info-path">${escapeHtml(info.path)}</div>`);
	html += `<div class="inspector-actions"><button class="btn btn-secondary btn-sm" id="inspectorReveal">${ICON("reveal")}${escapeHtml(tr.revealInFinder)}</button></div>`;
	body.innerHTML = html;
	$("inspectorReveal").addEventListener("click", () => revealPath(info.path));
}

$("infoPanelClose").addEventListener("click", closeInfoPanel);
$("infoPanelBackdrop").addEventListener("click", closeInfoPanel);

document.addEventListener("keydown", (e) => {
	const modal = openModalId();
	if (e.key === "Escape") {
		if (!$("envsecImportForm").classList.contains("hidden")) return; // handled by the form
		if (modal) {
			e.preventDefault();
			closeModal(modal);
			return;
		}
		if (infoPanelOpen) {
			e.preventDefault();
			closeInfoPanel();
			return;
		}
		if (isScanning) {
			e.preventDefault();
			run(cancelScan());
			return;
		}
	}

	if (modal) return;

	// ⌘N: new scan, ⌘,: settings (macOS conventions)
	if (e.metaKey && e.key === "n") {
		e.preventDefault();
		$("btnNewScan").click();
		return;
	}
	if (e.metaKey && e.key === ",") {
		e.preventDefault();
		openModal("modal-settings");
		return;
	}

	const activeScreen = document.querySelector(".screen.active");
	const isResults = activeScreen?.id === "screen-results";
	const isInputFocused =
		document.activeElement instanceof HTMLInputElement ||
		document.activeElement instanceof HTMLTextAreaElement ||
		document.activeElement instanceof HTMLSelectElement;
	if (isInputFocused || !isResults) return;

	if (e.key === "Backspace" && !e.metaKey) {
		e.preventDefault();
		run(navigateBack());
		return;
	}
	// Arrow keys work even before the list has focus
	if ((e.key === "ArrowDown" || e.key === "ArrowUp") && document.activeElement !== $("dirList")) {
		e.preventDefault();
		$("dirList").focus({ preventScroll: true });
		selectRow(selectedIndex < 0 ? 0 : selectedIndex + (e.key === "ArrowDown" ? 1 : -1));
	}
});

// --- Stats Widget (Canvas 2D sparkline bar chart) ---
let statsAnimId2: number | null = null;

// Runs in the "stats" slot, so only the latest render applies its result.
const renderStatsWidget = Effect.fn("renderStatsWidget")(function* () {
	const widget = $("statsWidget");
	const tr = t();

	const backend = yield* Backend;
	const stats = yield* backend.getStats({ days: 14 }).pipe(
		Effect.catchTag("BackendError", () => Effect.succeed(null)),
	);

	if (!stats || stats.totalFreed === 0) {
		widget.classList.add("hidden");
		if (statsAnimId2) { cancelAnimationFrame(statsAnimId2); statsAnimId2 = null; }
		return;
	}

	widget.classList.remove("hidden");
	$("statsWidgetTitle").textContent = tr.statsTitle;
	$("statsWidgetTotal").textContent = formatSize(stats.totalFreed);
	$("statsWidget").title = tr.statsTitle + " · 14d";

	// Build 14-day array (fill gaps with 0)
	const days: { date: string; freedBytes: number }[] = [];
	const now = new Date();
	for (let i = 13; i >= 0; i--) {
		const d = new Date(now);
		d.setDate(d.getDate() - i);
		const dateStr = d.toISOString().slice(0, 10);
		const entry = stats.entries.find((e) => e.date === dateStr);
		days.push({ date: dateStr, freedBytes: entry?.freedBytes ?? 0 });
	}

	const maxBytes = Math.max(...days.map((d) => d.freedBytes), 1);

	// Setup canvas
	const container = $("statsChart");
	let canvas = container.querySelector("canvas") as HTMLCanvasElement | null;
	if (!canvas) {
		canvas = document.createElement("canvas");
		container.appendChild(canvas);
	}

	const rect = container.getBoundingClientRect();
	const dpr = window.devicePixelRatio || 1;
	const w = rect.width;
	const h = rect.height;
	if (w === 0 || h === 0) return;

	canvas.width = w * dpr;
	canvas.height = h * dpr;
	canvas.style.width = w + "px";
	canvas.style.height = h + "px";

	const ctx = canvas.getContext("2d")!;
	const success = cssVar("--success");
	const empty = cssVar("--surface-3");
	const barGap = 3;
	const barWidth = (w - barGap * (days.length - 1)) / days.length;

	// Animate entrance
	if (statsAnimId2) cancelAnimationFrame(statsAnimId2);
	const animStart = performance.now();
	const animDuration = 500;

	function drawFrame(now: number) {
		const elapsed = now - animStart;
		const globalProgress = Math.min(elapsed / animDuration, 1);

		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, canvas!.width, canvas!.height);
		ctx.scale(dpr, dpr);

		for (let i = 0; i < days.length; i++) {
			const d = days[i]!;
			const normalizedH = d.freedBytes > 0 ? (d.freedBytes / maxBytes) * h : 0;

			const delay = i * 20;
			const barProgress = Math.max(0, Math.min((elapsed - delay) / (animDuration * 0.7), 1));
			const ease = 1 - Math.pow(1 - barProgress, 3);
			const barH = Math.max(normalizedH > 0 ? 2 : 0, normalizedH * ease);

			const x = i * (barWidth + barGap);
			const y = h - barH;

			ctx.fillStyle = d.freedBytes > 0 ? success : empty;
			ctx.globalAlpha = d.freedBytes > 0 ? 0.45 + 0.55 * (d.freedBytes / maxBytes) : 1;

			const radius = Math.min(2, barWidth / 2, barH / 2);
			ctx.beginPath();
			ctx.moveTo(x + radius, y);
			ctx.lineTo(x + barWidth - radius, y);
			ctx.quadraticCurveTo(x + barWidth, y, x + barWidth, y + radius);
			ctx.lineTo(x + barWidth, y + barH);
			ctx.lineTo(x, y + barH);
			ctx.lineTo(x, y + radius);
			ctx.quadraticCurveTo(x, y, x + radius, y);
			ctx.closePath();
			ctx.fill();

			ctx.globalAlpha = 1;
			if (d.freedBytes === 0) {
				ctx.fillStyle = empty;
				ctx.fillRect(x, h - 3, barWidth, 3);
			}
		}

		if (globalProgress < 1) {
			statsAnimId2 = requestAnimationFrame(drawFrame);
		} else {
			statsAnimId2 = null;
		}
	}

	statsAnimId2 = requestAnimationFrame(drawFrame);
});

// --- Version label ---
const loadVersionLabel = Effect.fn("loadVersionLabel")(
	function* () {
		const backend = yield* Backend;
		const info = yield* backend.getAppVersion({});
		const label = document.getElementById("versionLabel");
		if (label && info?.version) {
			label.textContent = `v${info.version}`;
		}
	},
	Effect.catchTag("BackendError", () => Effect.void),
);

// --- Init ---
populateLanguageSelector();
applyTranslations();
run(
	Effect.gen(function* () {
		yield* background(renderCacheList());
		yield* background(loadSettingsUI());
		yield* background(loadQuickPicks());
		yield* inSlot("stats", renderStatsWidget());
		yield* background(loadVersionLabel());
	}),
);
scanPathInput.focus();
