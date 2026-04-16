import Electrobun, { Electroview } from "electrobun/view";
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
			getCacheList: { params: {}; response: { entries: { rootPath: string; timestamp: number }[] } };
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
			scanProgress: { currentDir: string };
			error: { message: string };
			updateAvailable: { version: string };
			updateReady: { version: string };
			updateError: { message: string };
		};
	};
};

const rpc = Electroview.defineRPC<AppRPC>({
	maxRequestTime: 300000,
	handlers: {
		requests: {},
		messages: {
			scanProgress: ({ currentDir }) => {
				const dirEl = document.getElementById("scanCurrentDir");
				if (dirEl) {
					const maxLen = 60;
					if (currentDir.length > maxLen) {
						dirEl.textContent = "…" + currentDir.slice(-(maxLen - 1));
					} else {
						dirEl.textContent = currentDir;
					}
				}
			},
			error: ({ message }) => {
				console.error(`[fe] error received: ${message}`);
				alert(t().errorPrefix + " " + message);
				showScreen("welcome");
			},
			updateAvailable: ({ version }) => {
				console.log(`[fe] Update available: ${version}`);
				showUpdateBanner(version);
			},
			updateReady: ({ version }) => {
				console.log(`[fe] Update ready: ${version}`);
				showUpdateReadyBanner(version);
			},
			updateError: ({ message }) => {
				console.error(`[fe] Update error: ${message}`);
				hideUpdateBanner();
			},
		},
	},
});

const electrobun = new Electrobun.Electroview({ rpc });

// --- Titlebar drag (manual implementation for WebKit) ---
{
	const titlebar = document.getElementById("titlebar")!;
	let isDragging = false;
	let dragStartX = 0;
	let dragStartY = 0;
	let winStartX = 0;
	let winStartY = 0;

	titlebar.addEventListener("mousedown", async (e: MouseEvent) => {
		// Ignore clicks on interactive children (buttons, inputs, etc.)
		if ((e.target as HTMLElement).closest("button, input, select, a, [data-no-drag]")) return;
		if (e.button !== 0) return;

		isDragging = true;
		dragStartX = e.screenX;
		dragStartY = e.screenY;
		try {
			const pos = await electrobun.rpc?.request?.getWindowPosition({});
			if (pos) {
				winStartX = pos.x;
				winStartY = pos.y;
			}
		} catch {}
		e.preventDefault();
	});

	window.addEventListener("mousemove", (e: MouseEvent) => {
		if (!isDragging) return;
		const dx = e.screenX - dragStartX;
		const dy = e.screenY - dragStartY;
		electrobun.rpc?.request?.moveWindow({ x: winStartX + dx, y: winStartY + dy });
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
let toastTimeout: ReturnType<typeof setTimeout> | null = null;
let currentCleanables: CleanableResult | null = null;
let cleanableSelected: Set<string> = new Set();
let activeCleanFilters: Set<string> = new Set(); // empty = show all (no filter)
let isScanning = false;
let envsecAvailable: boolean | null = null; // null = not checked yet

// --- Update banner ---
function showUpdateBanner(version: string) {
	let banner = document.getElementById("updateBanner");
	if (!banner) {
		banner = document.createElement("div");
		banner.id = "updateBanner";
		banner.style.cssText = "position:fixed;top:38px;left:0;right:0;z-index:9999;display:flex;align-items:center;justify-content:center;gap:12px;padding:8px 16px;background:#1a3a2a;color:#4ade80;font-size:13px;border-bottom:1px solid #2d5a3d;-webkit-app-region:no-drag;";
		document.body.prepend(banner);
	}
	banner.innerHTML = `
		<span>🚀 ${t().updateAvailableText?.(version) ?? `Version ${version} is available`}</span>
		<button id="updateDownloadBtn" style="background:#22c55e;color:#000;border:none;border-radius:6px;padding:4px 14px;font-size:12px;font-weight:600;cursor:pointer;">${t().updateDownload ?? "Download"}</button>
		<button id="updateDismissBtn" style="background:none;border:none;color:#6b7280;cursor:pointer;font-size:16px;padding:2px 6px;">✕</button>
	`;
	document.getElementById("updateDownloadBtn")!.onclick = async () => {
		const btn = document.getElementById("updateDownloadBtn") as HTMLButtonElement;
		btn.textContent = t().updateDownloading ?? "Downloading…";
		btn.disabled = true;
		btn.style.opacity = "0.6";
		await rpc.request.downloadUpdate({});
	};
	document.getElementById("updateDismissBtn")!.onclick = () => hideUpdateBanner();
}

function showUpdateReadyBanner(version: string) {
	let banner = document.getElementById("updateBanner");
	if (!banner) {
		banner = document.createElement("div");
		banner.id = "updateBanner";
		banner.style.cssText = "position:fixed;top:38px;left:0;right:0;z-index:9999;display:flex;align-items:center;justify-content:center;gap:12px;padding:8px 16px;background:#1a3a2a;color:#4ade80;font-size:13px;border-bottom:1px solid #2d5a3d;-webkit-app-region:no-drag;";
		document.body.prepend(banner);
	}
	banner.innerHTML = `
		<span>✅ ${t().updateReadyText?.(version) ?? `Version ${version} is ready to install`}</span>
		<button id="updateApplyBtn" style="background:#22c55e;color:#000;border:none;border-radius:6px;padding:4px 14px;font-size:12px;font-weight:600;cursor:pointer;">${t().updateInstall ?? "Restart & Update"}</button>
		<button id="updateDismissBtn" style="background:none;border:none;color:#6b7280;cursor:pointer;font-size:16px;padding:2px 6px;">✕</button>
	`;
	document.getElementById("updateApplyBtn")!.onclick = async () => {
		await rpc.request.applyUpdate({});
	};
	document.getElementById("updateDismissBtn")!.onclick = () => hideUpdateBanner();
}

function hideUpdateBanner() {
	document.getElementById("updateBanner")?.remove();
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
	banner.classList.remove("hidden");
	banner.classList.remove("clean-banner-scanning");
	$("cleanBannerMsg").textContent = t().cleanRecoverable(formatSize(scoped.totalSize), scoped.items.length);
	$("btnOpenClean").classList.remove("hidden");
}

// --- Cancel scan ---
async function cancelScan() {
	if (!isScanning) return;
	console.log("[fe] cancelScan requested");
	try {
		await electrobun.rpc?.request?.cancelScan({});
	} catch (e) {
		console.error("[fe] cancelScan error:", e);
	}
}

// --- Clean shutdown: cancel any active scan before closing ---
window.addEventListener("beforeunload", () => {
	if (isScanning) {
		cancelScan();
	}
});

// --- Scan helper ---
async function startScan(dirPath: string) {
	showScreen("scanning");
	isScanning = true;
	console.log(`[fe] startScan: requesting scanDirectory dirPath="${dirPath}"`);
	try {
		const result = await electrobun.rpc?.request?.scanDirectory({ dirPath });
		console.log(`[fe] startScan: response received`, result);
		isScanning = false;
		if (!result || !result.success || !result.rootPath) {
			if (result?.error === "SCAN_CANCELLED") {
				showScreen("welcome");
				renderCacheList();
				return;
			}
			alert(t().errorPrefix + " " + (result?.error || t().scanFailed));
			showScreen("welcome");
			renderCacheList();
			return;
		}
		await loadTreeFromCache(result.rootPath, false);
		detectAndShowCleanables(result.rootPath, false);
	} catch (e) {
		console.error(`[fe] startScan error:`, e);
		isScanning = false;
		showScreen("welcome");
		renderCacheList();
	}
}

async function loadTreeFromCache(rootPath: string, preserveNav: boolean) {
	console.log(`[fe] loadTreeFromCache: rootPath="${rootPath}" preserveNav=${preserveNav}`);
	const res = await electrobun.rpc?.request?.getChildren({ dirPath: rootPath });
	if (!res || !res.children || res.children.length === 0) {
		console.log(`[fe] loadTreeFromCache: no children`);
		showScreen("welcome");
		renderCacheList();
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
		showScreen("results");
		renderResults(tree);
	}
}

// --- DOM ---
const $ = (id: string) => document.getElementById(id)!;
const scanPathInput = $("scanPath") as HTMLInputElement;

// --- Screens ---
function showScreen(name: "welcome" | "scanning" | "results") {
	document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
	$(`screen-${name}`).classList.add("active");
	const settings = $("settingsSection");
	if (name === "welcome") {
		settings.classList.remove("hidden");
		$("settingsTab").classList.remove("hidden");
		$("cleanBanner").classList.add("hidden");
		currentCleanables = null;
		renderStatsWidget();
	} else {
		settings.classList.add("hidden");
		settings.classList.remove("settings-open");
		$("settingsTab").classList.add("hidden");
		$("settingsTab").classList.remove("settings-tab-hidden");
		$("settingsOverlayBackdrop").classList.remove("visible");
	}
}

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
const COLORS = [
	"#6c5ce7", "#00b894", "#e17055", "#0984e3", "#fdcb6e",
	"#e84393", "#00cec9", "#d63031", "#74b9ff", "#55efc4",
	"#fab1a0", "#a29bfe", "#81ecec", "#ffeaa7", "#dfe6e9",
];

function getColor(index: number): string {
	return COLORS[index % COLORS.length]!;
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
		rects.push({ x, y, w, h, entry: entries[0]!, color: getColor(rects.length) });
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
			rects.push({ x: cx, y: cy, w: stripW, h: eH, entry: e, color: getColor(rects.length) });
			cy += eH;
		}
		const remaining = entries.slice(stripEntries.length);
		layoutStrip(remaining, x + stripW, y, w - stripW, h, totalSize - stripSize, rects);
	} else {
		const stripH = h * stripFraction;
		for (const e of stripEntries) {
			const eFraction = e.size / stripSize;
			const eW = w * eFraction;
			rects.push({ x: cx, y: cy, w: eW, h: stripH, entry: e, color: getColor(rects.length) });
			cx += eW;
		}
		const remaining = entries.slice(stripEntries.length);
		layoutStrip(remaining, x, y + stripH, w, h - stripH, totalSize - stripSize, rects);
	}
}

let treemapRects: TreemapRect[] = [];
let treemapAnimId: number | null = null;
let skipNextAnimation = false;

function drawTreemapFrame(ctx: CanvasRenderingContext2D, rects: TreemapRect[], alpha: number, canvasW?: number, canvasH?: number) {
	const pad = 2;
	const containerR = 12;
	const innerR = containerR - pad;
	const defaultR = 4;
	const edgeTolerance = 1;

	for (const r of rects) {
		ctx.fillStyle = r.color;
		ctx.globalAlpha = 0.85 * alpha;

		const w = canvasW || 9999;
		const h = canvasH || 9999;
		const touchTop = r.y <= pad + edgeTolerance;
		const touchLeft = r.x <= pad + edgeTolerance;
		const touchBottom = (r.y + r.h) >= h - pad - edgeTolerance;
		const touchRight = (r.x + r.w) >= w - pad - edgeTolerance;

		const radii: [number, number, number, number] = [
			(touchTop && touchLeft) ? innerR : defaultR,
			(touchTop && touchRight) ? innerR : defaultR,
			(touchBottom && touchRight) ? innerR : defaultR,
			(touchBottom && touchLeft) ? innerR : defaultR,
		];

		roundRect(ctx, r.x, r.y, r.w - 1.5, r.h - 1.5, radii);
		ctx.fill();
		ctx.globalAlpha = alpha;

		if (r.w > 50 && r.h > 28) {
			ctx.fillStyle = `rgba(255,255,255,${0.9 * alpha})`;
			ctx.font = "600 11px -apple-system, system-ui, sans-serif";
			const label = truncateText(ctx, r.entry.name, r.w - 12);
			ctx.fillText(label, r.x + 6, r.y + 16);

			if (r.h > 40) {
				ctx.fillStyle = `rgba(255,255,255,${0.55 * alpha})`;
				ctx.font = "10px -apple-system, system-ui, sans-serif";
				ctx.fillText(formatSize(r.entry.size), r.x + 6, r.y + 30);
			}
		}
	}
	ctx.globalAlpha = 1;
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
	if (hit) {
		tooltip.classList.remove("hidden");
		tooltip.querySelector(".tt-name")!.textContent = hit.entry.name;
		tooltip.querySelector(".tt-size")!.textContent = formatSize(hit.entry.size);
		const tx = Math.min(e.clientX - rect.left + 12, rect.width - 160);
		const ty = Math.min(e.clientY - rect.top + 12, rect.height - 50);
		tooltip.style.left = tx + "px";
		tooltip.style.top = ty + "px";
	} else {
		tooltip.classList.add("hidden");
	}
});

treemapCanvas.addEventListener("mouseleave", () => {
	tooltip.classList.add("hidden");
});

treemapCanvas.addEventListener("click", async (e) => {
	const rect = treemapCanvas.getBoundingClientRect();
	const mx = e.clientX - rect.left;
	const my = e.clientY - rect.top;
	const hit = treemapRects.find((r) => mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h);
	if (hit && hit.entry.isDir) {
		if (!hit.entry.children || hit.entry.children.length === 0) {
			try {
				const res = await electrobun.rpc?.request?.getChildren({ dirPath: hit.entry.path });
				if (res && res.children && res.children.length > 0) {
					hit.entry.children = res.children;
					hit.entry.size = res.children.reduce((s: number, c: DirEntry) => s + c.size, 0);
				} else {
					return;
				}
			} catch {
				return;
			}
		}
		navigationStack.push(hit.entry);
		renderResults(hit.entry);
	}
});

// --- Render results ---
function renderBreadcrumb() {
	const nav = $("breadcrumb");
	nav.innerHTML = "";
	for (let i = 0; i < navigationStack.length; i++) {
		if (i > 0) {
			const sep = document.createElement("span");
			sep.className = "breadcrumb-sep";
			sep.textContent = "›";
			nav.appendChild(sep);
		}
		const crumb = document.createElement("span");
		crumb.className = "breadcrumb-item" + (i === navigationStack.length - 1 ? " current" : "");
		crumb.textContent = navigationStack[i]!.name;
		crumb.title = navigationStack[i]!.path;
		if (i < navigationStack.length - 1) {
			const idx = i;
			crumb.addEventListener("click", () => {
				navigationStack = navigationStack.slice(0, idx + 1);
				renderResults(navigationStack[navigationStack.length - 1]!);
			});
		}
		nav.appendChild(crumb);
	}
}

function renderResults(entry: DirEntry) {
	$("totalSize").textContent = formatSize(entry.size);
	renderBreadcrumb();

	const children = (entry.children || []).filter((c) => c.size > 0);
	renderTreemap(children);
	renderDirList(children, entry.size);
	updateCleanBanner();
}

function renderDirList(entries: DirEntry[], parentSize: number) {
	const list = $("dirList");
	list.innerHTML = "";

	for (const entry of entries) {
		const pct = parentSize > 0 ? (entry.size / parentSize) * 100 : 0;
		const colorIdx = entries.indexOf(entry);
		const item = document.createElement("div");
		item.className = "dir-item";
		const infoIcon = `<svg class="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
		const dirIcon = `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
		const fileIcon = `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
		const trashIcon = `<svg class="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
		item.innerHTML = `
			<div class="dir-item-icon">${entry.isDir ? dirIcon : fileIcon}</div>
			<div class="dir-item-info">
				<div class="dir-item-name">${escapeHtml(entry.name)}</div>
				<div class="dir-item-path">${escapeHtml(entry.path)}</div>
			</div>
			<div class="dir-item-bar">
				<div class="dir-item-bar-fill" style="width:${pct}%;background:${getColor(colorIdx)}"></div>
			</div>
			<div class="dir-item-size">${formatSize(entry.size)}</div>
			<div class="dir-item-actions">
				<button class="btn-info" data-path="${escapeAttr(entry.path)}" title="Info">${infoIcon}</button>
				<button class="btn-delete" data-path="${escapeAttr(entry.path)}" data-name="${escapeAttr(entry.name)}" data-size="${entry.size}">${trashIcon}</button>
			</div>
		`;

		if (entry.isDir) {
			item.addEventListener("click", async (e) => {
				if ((e.target as HTMLElement).classList.contains("btn-delete")) return;
				if (!entry.children || entry.children.length === 0) {
					try {
						const res = await electrobun.rpc?.request?.getChildren({ dirPath: entry.path });
						if (res && res.children && res.children.length > 0) {
							entry.children = res.children;
							entry.size = res.children.reduce((s: number, c: DirEntry) => s + c.size, 0);
						} else {
							return;
						}
					} catch {
						return;
					}
				}
				navigationStack.push(entry);
				renderResults(entry);
			});
			item.style.cursor = "pointer";
		}

		list.appendChild(item);
	}

	// Delete buttons
	list.querySelectorAll(".btn-delete").forEach((btn) => {
		btn.addEventListener("click", (e) => {
			e.stopPropagation();
			const el = e.currentTarget as HTMLElement;
			pendingDeletePath = el.dataset.path || null;
			pendingDeleteSize = Number(el.dataset.size || 0);
			const name = el.dataset.name || "";
			const size = pendingDeleteSize;
			const isTrash = settingDeleteMode.value === "trash";
			$("deleteMessage").textContent = isTrash
				? t().deleteConfirmMessageTrash(name, formatSize(size))
				: t().deleteConfirmMessage(name, formatSize(size));
			$("modal-delete").classList.remove("hidden");
		});
	});

	// Info buttons
	list.querySelectorAll(".btn-info").forEach((btn) => {
		btn.addEventListener("click", (e) => {
			e.stopPropagation();
			const el = e.currentTarget as HTMLElement;
			const path = el.dataset.path;
			if (path) openInfoPanel(path);
		});
	});
}

function escapeHtml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escapeAttr(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// --- Smart Clean ---
async function detectAndShowCleanables(rootPath: string, useCache: boolean = true) {
	const banner = $("cleanBanner");
	banner.classList.remove("hidden");
	banner.classList.add("clean-banner-scanning");
	$("cleanBannerMsg").textContent = t().cleanAnalyzing;
	$("btnOpenClean").classList.add("hidden");

	try {
		// Try cached cleanables first (only when opening from cache, not after a new scan)
		if (useCache) {
			const cached = await electrobun.rpc?.request?.getCachedCleanables({ rootPath });
			if (cached?.found && cached.cleanables && cached.cleanables.items.length > 0) {
				currentCleanables = cached.cleanables;
				cleanableSelected = new Set(cached.cleanables.items.map((i) => i.path));
				banner.classList.remove("clean-banner-scanning");
				const count = cached.cleanables.items.length;
				$("cleanBannerMsg").textContent = t().cleanRecoverable(formatSize(cached.cleanables.totalSize), count);
				$("btnOpenClean").classList.remove("hidden");
				return;
			}
		}

		const result = await electrobun.rpc?.request?.detectCleanables({ rootPath });
		if (!result || result.items.length === 0) {
			banner.classList.add("hidden");
			currentCleanables = null;
			// Save empty result to cache so we don't re-scan next time
			await electrobun.rpc?.request?.saveCachedCleanables({ rootPath, cleanables: { items: [], totalSize: 0 } });
			return;
		}
		currentCleanables = result;
		cleanableSelected = new Set(result.items.map((i) => i.path));
		banner.classList.remove("clean-banner-scanning");
		const count = result.items.length;
		$("cleanBannerMsg").textContent = t().cleanRecoverable(formatSize(result.totalSize), count);
		$("btnOpenClean").classList.remove("hidden");
		// Save to cache for next time
		await electrobun.rpc?.request?.saveCachedCleanables({ rootPath, cleanables: result });
	} catch (e) {
		console.error("[cleanables] detection error:", e);
		banner.classList.add("hidden");
		currentCleanables = null;
	}
}

function openCleanModal() {
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
		electrobun.rpc?.request?.checkEnvsecAvailable({}).then((res) => {
			envsecAvailable = res?.available ?? false;
			renderCleanList(); // re-render with updated button states
		});
	}

	// Hide envsec form if open from previous session
	$("envsecImportForm").classList.add("hidden");

	buildCleanFilters();
	renderCleanList();

	(document.getElementById("cleanSelectAll") as HTMLInputElement).checked = true;
	updateCleanSelection();
	modal.classList.remove("hidden");
}

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

function renderCleanList() {
	const list = $("cleanList");
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
		const titleAttr = item.note ? ` title="${escapeAttr(item.note === "sensitiveDataFound" ? t().sensitiveDataFound : item.note)}"` : "";
		const isEnvFile = item.category === "secrets" && item.folderName.startsWith(".env");
		const envsecDisabled = isEnvFile && !envsecAvailable;
		row.innerHTML = `
			<input type="checkbox" ${isChecked ? "checked" : ""} data-path="${escapeAttr(item.path)}" />
			<div class="clean-item-info"${titleAttr}>
				<div class="clean-item-project">${escapeHtml(item.projectPath)}</div>
				<div class="clean-item-detail">${escapeHtml(item.folderName)}${item.note === "sensitiveDataFound" ? ` <span class="clean-item-warning">⚠ ${escapeHtml(t().sensitiveDataFound)}</span>` : ""}</div>
			</div>
			<div class="clean-item-type${item.category === "secrets" ? " clean-item-type-secrets" : ""}">${item.category === "secrets" ? "🔑 " : ""}${escapeHtml(item.projectType)}</div>
			<div class="clean-item-size">${formatSize(item.size)}</div>
			<div class="clean-item-actions">
				<button class="btn-reveal" data-reveal-path="${escapeAttr(item.path)}" title="${escapeAttr(t().revealInFinder)}"><svg class="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="9" y1="14" x2="15" y2="14"/></svg></button>
				${isEnvFile ? `<button class="btn-envsec${envsecDisabled ? " btn-envsec-disabled" : ""}" ${envsecDisabled ? "disabled" : ""} data-envsec-path="${escapeAttr(item.path)}" data-envsec-project="${escapeAttr(item.projectPath)}" data-envsec-name="${escapeAttr(item.folderName)}" data-envsec-size="${item.size}" title="${escapeAttr(envsecDisabled ? t().envsecNotAvailable : t().importToEnvsec)}"><svg class="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>${envsecDisabled ? '<span class="envsec-pro-badge">PRO</span>' : ""}</button>` : ""}
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
		const revealBtn = row.querySelector(".btn-reveal")!;
		revealBtn.addEventListener("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			electrobun.rpc?.request?.revealInFinder({ filePath: item.path });
		});
		const envsecBtn = row.querySelector(".btn-envsec");
		if (envsecBtn && !envsecBtn.hasAttribute("disabled")) {
			envsecBtn.addEventListener("click", (e) => {
				e.preventDefault();
				e.stopPropagation();
				openEnvsecImportForm(
					envsecBtn.getAttribute("data-envsec-path")!,
					envsecBtn.getAttribute("data-envsec-project")!,
					envsecBtn.getAttribute("data-envsec-name")!,
					Number(envsecBtn.getAttribute("data-envsec-size") || 0),
				);
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

async function confirmEnvsecImport() {
	if (!pendingEnvsecPath) return;
	const context = ($("envsecContextInput") as HTMLInputElement).value.trim();
	if (!context) return;
	const filePath = pendingEnvsecPath;
	const fileSize = pendingEnvsecSize;
	const confirmBtn = $("btnEnvsecConfirm") as HTMLButtonElement;
	confirmBtn.disabled = true;
	$("btnEnvsecConfirmText").textContent = t().envsecImporting;
	try {
		const result = await electrobun.rpc?.request?.importEnvToEnvsec({ filePath, context });
		if (result?.success) {
			closeEnvsecImportForm();
			showFreedToast(fileSize);
			totalFreedBytes += fileSize;
			electrobun.rpc?.request?.recordDeletion({ freedBytes: fileSize, deleteCount: 1 });
			// Refresh the view
			if (currentTree) {
				await loadTreeFromCache(currentTree.path, true);
				detectAndShowCleanables(currentTree.path, false);
			}
			$("modal-clean").classList.add("hidden");
		} else {
			alert(t().envsecImportError + (result?.error ? `: ${result.error}` : ""));
		}
	} catch {
		alert(t().envsecImportError);
	} finally {
		confirmBtn.disabled = false;
		$("btnEnvsecConfirmText").textContent = t().envsecConfirmImport;
	}
}

$("btnEnvsecCancel").addEventListener("click", closeEnvsecImportForm);
$("btnEnvsecConfirm").addEventListener("click", confirmEnvsecImport);
$("envsecContextInput").addEventListener("keydown", (e) => {
	if (e.key === "Enter") confirmEnvsecImport();
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

$("btnOpenClean").addEventListener("click", () => openCleanModal());

$("btnCancelClean").addEventListener("click", () => {
	$("modal-clean").classList.add("hidden");
});

$("modal-clean").querySelector(".modal-backdrop")!.addEventListener("click", () => {
	$("modal-clean").classList.add("hidden");
});

$("btnConfirmClean").addEventListener("click", async () => {
	if (cleanableSelected.size === 0) return;
	const paths = Array.from(cleanableSelected);
	const btn = $("btnConfirmClean") as HTMLButtonElement;
	btn.disabled = true;
	$("btnConfirmCleanText").textContent = t().cleaningInProgress;

	try {
		const result = await electrobun.rpc?.request?.batchDelete({ paths });
		$("modal-clean").classList.add("hidden");

		if (result) {
			if (result.deletedSize > 0) {
				totalFreedBytes += result.deletedSize;
				showFreedToast(result.deletedSize);
				electrobun.rpc?.request?.recordDeletion({ freedBytes: result.deletedSize, deleteCount: result.deletedCount });
			}
			if (result.errors.length > 0) {
				console.error("[cleanables] batch delete errors:", result.errors);
			}
			if (currentTree) {
				await loadTreeFromCache(currentTree.path, true);
				detectAndShowCleanables(currentTree.path, false);
			}
		}
	} catch (e) {
		console.error("[cleanables] batch delete error:", e);
		$("modal-clean").classList.add("hidden");
	}
});

// --- Navigation ---
$("btnBack").addEventListener("click", () => {
	if (navigationStack.length > 1) {
		navigationStack.pop();
		renderResults(navigationStack[navigationStack.length - 1]!);
	} else {
		showScreen("welcome");
		renderCacheList();
	}
});

// --- Scan ---
$("btnScan").addEventListener("click", () => {
	const dirPath = scanPathInput.value.trim();
	if (!dirPath) return;
	acList.classList.add("hidden");
	startScan(dirPath);
});

$("btnRescan").addEventListener("click", () => {
	const dirPath = scanPathInput.value.trim();
	startScan(dirPath);
});

$("btnCancelScan").addEventListener("click", () => {
	cancelScan();
});

// --- Render cache list ---
async function renderCacheList() {
	const result = await electrobun.rpc?.request?.getCacheList({});
	const container = $("cacheList");
	container.innerHTML = "";
	if (!result || result.entries.length === 0) {
		container.classList.add("hidden");
		return;
	}
	container.classList.remove("hidden");
	for (const entry of result.entries) {
		const date = new Date(entry.timestamp);
		const dateStr = date.toLocaleDateString(getLocale(), {
			day: "numeric", month: "short",
			hour: "2-digit", minute: "2-digit",
		});
		const card = document.createElement("div");
		card.className = "cache-card";
		card.innerHTML = `
			<div class="cache-card-info">
				<span class="cache-card-path" title="${escapeAttr(entry.rootPath)}">${escapeHtml(entry.rootPath.replace(/\/$/, ""))}</span>
				<span class="cache-card-date">${dateStr}</span>
			</div>
			<div class="cache-card-actions">
				<button class="btn btn-sm btn-secondary cache-card-btn" data-action="open" data-path="${escapeAttr(entry.rootPath)}">${t().openCache}</button>
				<button class="btn btn-sm btn-primary cache-card-btn" data-action="rescan" data-path="${escapeAttr(entry.rootPath)}">${t().scanCache}</button>
			</div>
			<button class="cache-card-delete" data-action="delete-cache" data-path="${escapeAttr(entry.rootPath)}" title="${t().removeCache}"><svg class="icon icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
		`;
		container.appendChild(card);
	}
	container.querySelectorAll("[data-action='open']").forEach((btn) => {
		btn.addEventListener("click", async (e) => {
			const path = (e.currentTarget as HTMLElement).dataset.path!;
			scanPathInput.value = path;
			await loadTreeFromCache(path, false);
			detectAndShowCleanables(path);
		});
	});
	container.querySelectorAll("[data-action='rescan']").forEach((btn) => {
		btn.addEventListener("click", (e) => {
			const path = (e.currentTarget as HTMLElement).dataset.path!;
			scanPathInput.value = path;
			startScan(path);
		});
	});
	container.querySelectorAll("[data-action='delete-cache']").forEach((btn) => {
		btn.addEventListener("click", async (e) => {
			e.stopPropagation();
			const path = (e.currentTarget as HTMLElement).dataset.path!;
			await electrobun.rpc?.request?.deleteCacheEntry({ rootPath: path });
			renderCacheList();
		});
	});
}

// --- Delete modal ---
$("btnCancelDelete").addEventListener("click", () => {
	$("modal-delete").classList.add("hidden");
	pendingDeletePath = null;
	pendingDeleteSize = 0;
});

$("modal-delete").querySelector(".modal-backdrop")!.addEventListener("click", () => {
	$("modal-delete").classList.add("hidden");
	pendingDeletePath = null;
	pendingDeleteSize = 0;
});

$("btnConfirmDelete").addEventListener("click", async () => {
	if (!pendingDeletePath) return;
	$("modal-delete").classList.add("hidden");
	const path = pendingDeletePath;
	const deletedSize = pendingDeleteSize;
	pendingDeletePath = null;
	pendingDeleteSize = 0;

	const result = await electrobun.rpc?.request?.deleteEntry({ entryPath: path });
	if (result && !result.success) {
		alert(t().deleteError + " " + (result.error || t().unknownError));
	} else {
		totalFreedBytes += deletedSize;
		showFreedToast(deletedSize);
		electrobun.rpc?.request?.recordDeletion({ freedBytes: deletedSize, deleteCount: 1 });
		if (result?.rootPath) {
			await loadTreeFromCache(result.rootPath, true);
		}
	}
});

// --- Freed space toast ---
function showFreedToast(justFreed: number) {
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

	if (toastTimeout) clearTimeout(toastTimeout);
	toastTimeout = setTimeout(() => {
		toast.classList.remove("toast-enter");
		toast.classList.add("toast-exit");
		setTimeout(() => toast.classList.add("hidden"), 300);
	}, 3000);
}

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
		renderStatsWidget();
	}
});

// --- Autocomplete ---
const acList = $("autocompleteList");
const btnScan = $("btnScan") as HTMLButtonElement;
const scanPathLabel = $("scanPathLabel");
let acIndex = -1;
let acDebounce: ReturnType<typeof setTimeout> | null = null;
let validateDebounce: ReturnType<typeof setTimeout> | null = null;

async function validatePath(dirPath: string) {
	if (!dirPath.trim()) {
		btnScan.disabled = true;
		scanPathLabel.textContent = t().scanLabel;
		scanPathLabel.style.color = "";
		return;
	}
	const result = await electrobun.rpc?.request?.validatePath({ dirPath: dirPath.trim() });
	if (result?.valid) {
		btnScan.disabled = false;
		scanPathLabel.textContent = t().scanLabel;
		scanPathLabel.style.color = "";
	} else {
		btnScan.disabled = true;
		scanPathLabel.textContent = t().dirNotFound;
		scanPathLabel.style.color = "var(--danger)";
	}
}

async function fetchSuggestions(partial: string) {
	if (!partial || partial.length < 1) {
		acList.classList.add("hidden");
		return;
	}
	try {
		const result = await electrobun.rpc?.request?.listDir({ partial });
		console.log("[autocomplete] partial:", partial, "result:", result);
		if (!result || !result.suggestions || result.suggestions.length === 0) {
			acList.classList.add("hidden");
			return;
		}
		acIndex = -1;
		acList.innerHTML = "";
		for (const s of result.suggestions) {
			const item = document.createElement("div");
			item.className = "autocomplete-item";
			item.textContent = s;
			item.addEventListener("mousedown", (e) => {
				e.preventDefault();
				scanPathInput.value = s + "/";
				acList.classList.add("hidden");
				fetchSuggestions(s + "/");
				validatePath(s + "/");
			});
			acList.appendChild(item);
		}
		acList.classList.remove("hidden");
	} catch (err) {
		console.error("[autocomplete] error:", err);
		acList.classList.add("hidden");
	}
}

const inputHint = $("inputHint");

scanPathInput.addEventListener("input", () => {
	inputHint.style.display = scanPathInput.value ? "none" : "";
	if (acDebounce) clearTimeout(acDebounce);
	if (validateDebounce) clearTimeout(validateDebounce);
	acDebounce = setTimeout(() => {
		fetchSuggestions(scanPathInput.value);
	}, 120);
	validateDebounce = setTimeout(() => {
		validatePath(scanPathInput.value);
	}, 250);
});

scanPathInput.addEventListener("keydown", (e) => {
	const items = acList.querySelectorAll(".autocomplete-item");
	const isOpen = !acList.classList.contains("hidden") && items.length > 0;

	if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
		e.preventDefault();
		acList.classList.add("hidden");
		const dirPath = scanPathInput.value.trim();
		if (dirPath) {
			startScan(dirPath);
		}
		return;
	}

	if (e.key === "Enter") {
		if (isOpen && acIndex >= 0) {
			e.preventDefault();
			const selected = items[acIndex] as HTMLElement;
			const val = selected.textContent || "";
			scanPathInput.value = val + "/";
			acList.classList.add("hidden");
			fetchSuggestions(val + "/");
			validatePath(val + "/");
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
		const val = selected.textContent || "";
		scanPathInput.value = val + "/";
		acList.classList.add("hidden");
		fetchSuggestions(val + "/");
		validatePath(val + "/");
	}
});

function updateAcActive(items: NodeListOf<Element>) {
	items.forEach((el, i) => {
		el.classList.toggle("active", i === acIndex);
		if (i === acIndex) el.scrollIntoView({ block: "nearest" });
	});
}

scanPathInput.addEventListener("blur", () => {
	setTimeout(() => acList.classList.add("hidden"), 150);
});

scanPathInput.addEventListener("focus", () => {
	if (scanPathInput.value) fetchSuggestions(scanPathInput.value);
});

// --- Settings (responsive collapsed tab) ---
const settingsTab = $("settingsTab");
const settingsOverlayBackdrop = $("settingsOverlayBackdrop");

function openSettingsPanel() {
	const settings = $("settingsSection");
	settings.classList.add("settings-open");
	settings.classList.remove("hidden");
	settingsTab.classList.add("settings-tab-hidden");
	settingsOverlayBackdrop.classList.add("visible");
}

function closeSettingsPanel() {
	const settings = $("settingsSection");
	settings.classList.remove("settings-open");
	settingsTab.classList.remove("settings-tab-hidden");
	settingsOverlayBackdrop.classList.remove("visible");
}

settingsTab.addEventListener("click", openSettingsPanel);
settingsOverlayBackdrop.addEventListener("click", closeSettingsPanel);

// --- Settings ---
const settingMaxCache = $("settingMaxCache") as HTMLInputElement;
const settingMaxDepth = $("settingMaxDepth") as HTMLInputElement;
const settingDeleteMode = $("settingDeleteMode") as HTMLSelectElement;
const settingLang = $("settingLang") as HTMLSelectElement;
let settingsSaveDebounce: ReturnType<typeof setTimeout> | null = null;

async function loadSettingsUI() {
	const settings = await electrobun.rpc?.request?.getSettings({});
	if (settings) {
		settingMaxCache.value = String(settings.maxCacheEntries);
		settingMaxDepth.value = String(settings.maxDepth);
		settingDeleteMode.value = settings.deleteMode;
	}
}

function saveSettingsDebounced() {
	if (settingsSaveDebounce) clearTimeout(settingsSaveDebounce);
	settingsSaveDebounce = setTimeout(async () => {
		await electrobun.rpc?.request?.saveSettings({
			maxCacheEntries: Number(settingMaxCache.value) || 10,
			deleteMode: settingDeleteMode.value,
			maxDepth: Number(settingMaxDepth.value) || 10,
		});
	}, 400);
}

settingMaxCache.addEventListener("change", saveSettingsDebounced);
settingMaxCache.addEventListener("input", saveSettingsDebounced);
settingMaxDepth.addEventListener("change", saveSettingsDebounced);
settingMaxDepth.addEventListener("input", saveSettingsDebounced);
settingDeleteMode.addEventListener("change", saveSettingsDebounced);

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
	renderCacheList();
});

// --- Apply all translations to static DOM elements ---
function applyTranslations() {
	const tr = t();

	// HTML lang attribute
	document.documentElement.lang = getLanguage();

	// Welcome screen
	$("welcomeDesc").textContent = tr.welcomeDesc;
	$("scanPathLabel").textContent = tr.scanLabel;
	btnScan.textContent = tr.scanButton;

	// Scanning screen
	$("scanningText").textContent = tr.scanningText;
	$("btnCancelScan").textContent = tr.cancelScan;

	// Results screen
	$("btnBack").title = tr.backTitle;
	$("breadcrumb").setAttribute("aria-label", tr.navigation);
	$("btnRescan").textContent = tr.rescanButton;
	$("btnOpenClean").textContent = tr.cleanDetails;

	// Settings
	$("settingsHeaderText").textContent = tr.settingsTitle;
	$("settingsTabText").textContent = tr.settingsTitle;
	$("settingLangLabel").textContent = tr.language;
	$("settingMaxCacheLabel").textContent = tr.maxCache;
	$("settingMaxDepthLabel").textContent = tr.scanDepth;
	$("settingDeleteModeLabel").textContent = tr.deleteMode;
	$("optionTrash").textContent = tr.deleteModeTrash;
	$("optionPermanent").textContent = tr.deleteModePermanent;

	// Delete modal
	$("deleteModalTitle").textContent = tr.deleteConfirmTitle;
	$("btnCancelDelete").textContent = tr.cancel;
	$("btnConfirmDelete").textContent = tr.deleteButton;

	// Clean modal
	$("cleanModalTitle").textContent = tr.smartCleanTitle;
	$("cleanModalDesc").textContent = tr.cleanModalDesc;
	$("cleanSelectAllLabel").textContent = tr.selectAll;
	$("btnCancelClean").textContent = tr.cancel;
	$("btnConfirmCleanText").textContent = tr.cleanSelectedWithSize("");

	// Envsec import form
	$("envsecImportTitle").textContent = tr.envsecImportTitle;
	$("envsecContextLabel").textContent = tr.envsecContextPrompt;
	$("btnEnvsecCancel").textContent = tr.cancel;
	$("btnEnvsecConfirmText").textContent = tr.envsecConfirmImport;

	// Toast
	$("freedJustLabel").textContent = tr.freedJust;
	$("freedTotalLabel").textContent = tr.freedSessionTotal;

	// Info panel
	$("infoPanelClose").title = tr.closeEsc;
	$("infoPanelLoading").textContent = tr.loading;
}

// --- Info Panel ---
let infoPanelOpen = false;

function openInfoPanel(entryPath: string) {
	const panel = $("infoPanel");
	const backdrop = $("infoPanelBackdrop");
	const body = $("infoPanelBody");
	const title = $("infoPanelTitle");

	title.textContent = t().loading;
	body.innerHTML = `<div class="info-panel-loading">${t().loading}</div>`;

	panel.classList.remove("hidden");
	backdrop.classList.remove("hidden");
	void panel.offsetWidth;
	panel.classList.add("visible");
	backdrop.classList.add("visible");
	infoPanelOpen = true;

	electrobun.rpc?.request?.getEntryInfo({ entryPath }).then((info: any) => {
		if (!info || info.error) {
			body.innerHTML = `<div class="info-panel-loading">${t().loadError}</div>`;
			title.textContent = t().errorTitle;
			return;
		}
		title.textContent = info.name;
		renderInfoPanelContent(info as EntryInfo);
	}).catch(() => {
		body.innerHTML = `<div class="info-panel-loading">${t().connectionError}</div>`;
	});
}

function closeInfoPanel() {
	const panel = $("infoPanel");
	const backdrop = $("infoPanelBackdrop");
	panel.classList.remove("visible");
	backdrop.classList.remove("visible");
	infoPanelOpen = false;
	setTimeout(() => {
		panel.classList.add("hidden");
		backdrop.classList.add("hidden");
	}, 260);
}

function formatDate(ms: number): string {
	const d = new Date(ms);
	return d.toLocaleDateString(getLocale(), { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function renderInfoPanelContent(info: EntryInfo) {
	const body = $("infoPanelBody");
	const tr = t();
	let html = "";

	if (info.isDir) {
		html += `<div class="info-section">`;
		html += `<div class="info-section-title">${tr.details}</div>`;
		html += `<div class="info-row"><span class="info-row-label">${tr.size}</span><span class="info-row-value">${formatSize(info.size)}</span></div>`;
		html += `<div class="info-row"><span class="info-row-label">${tr.files}</span><span class="info-row-value">${info.fileCount ?? 0}</span></div>`;
		html += `<div class="info-row"><span class="info-row-label">${tr.folders}</span><span class="info-row-value">${info.dirCount ?? 0}</span></div>`;
		html += `<div class="info-row"><span class="info-row-label">${tr.lastModified}</span><span class="info-row-value">${formatDate(info.modifiedAt)}</span></div>`;
		html += `<div class="info-row"><span class="info-row-label">${tr.created}</span><span class="info-row-value">${formatDate(info.createdAt)}</span></div>`;
		html += `</div>`;

		if (info.largestFile) {
			html += `<div class="info-section">`;
			html += `<div class="info-section-title">${tr.largestFile}</div>`;
			html += `<div class="info-row"><span class="info-row-label">${escapeHtml(info.largestFile.name)}</span><span class="info-row-value">${formatSize(info.largestFile.size)}</span></div>`;
			html += `</div>`;
		}

		if (info.newestFile) {
			html += `<div class="info-section">`;
			html += `<div class="info-section-title">${tr.newestModified}</div>`;
			html += `<div class="info-row"><span class="info-row-label">${escapeHtml(info.newestFile.name)}</span><span class="info-row-value">${formatDate(info.newestFile.modifiedAt)}</span></div>`;
			html += `</div>`;
		}

		if (info.typeDistribution && info.typeDistribution.length > 0) {
			const typeLabelMap: Record<string, string> = {
				code: tr.typeCode, images: tr.typeImages, documents: tr.typeDocuments,
				config: tr.typeConfig, styles: tr.typeStyles, html: tr.typeHTML, other: tr.typeOther,
			};
			html += `<div class="info-section">`;
			html += `<div class="info-section-title">${tr.typeDistribution}</div>`;
			html += `<div class="info-type-bar">`;
			for (const td of info.typeDistribution) {
				html += `<div class="info-type-bar-seg" style="width:${td.percentage}%;background:${td.color}"></div>`;
			}
			html += `</div>`;
			html += `<div class="info-type-legend">`;
			for (const td of info.typeDistribution) {
				const label = typeLabelMap[td.label] || td.label;
				html += `<span class="info-type-legend-item"><span class="info-type-dot" style="background:${td.color}"></span>${escapeHtml(label)} ${td.percentage}%</span>`;
			}
			html += `</div>`;
			html += `</div>`;
		}
	} else {
		if (info.extension) {
			html += `<div style="margin-bottom:14px"><span class="info-ext-badge">${escapeHtml(info.extension)}</span></div>`;
		}

		html += `<div class="info-section">`;
		html += `<div class="info-section-title">${tr.details}</div>`;
		html += `<div class="info-row"><span class="info-row-label">${tr.size}</span><span class="info-row-value">${formatSize(info.size)}</span></div>`;
		html += `<div class="info-row"><span class="info-row-label">${tr.lastModified}</span><span class="info-row-value">${formatDate(info.modifiedAt)}</span></div>`;
		html += `<div class="info-row"><span class="info-row-label">${tr.created}</span><span class="info-row-value">${formatDate(info.createdAt)}</span></div>`;
		html += `</div>`;

		if (info.previewType === "text" && info.textPreview) {
			html += `<div class="info-section">`;
			html += `<div class="info-section-title">${tr.preview}</div>`;
			html += `<pre class="info-text-preview">${escapeHtml(info.textPreview)}</pre>`;
			html += `</div>`;
		} else if (info.previewType === "image") {
			html += `<div class="info-section">`;
			html += `<div class="info-section-title">${tr.preview}</div>`;
			html += `<img class="info-image-preview" src="file://${encodeURI(info.path)}" alt="${escapeAttr(info.name)}" />`;
			html += `</div>`;
		} else {
			html += `<div class="info-file-icon">📄</div>`;
		}
	}

	html += `<div class="info-section" style="margin-top:8px">`;
	html += `<div class="info-section-title">${tr.path}</div>`;
	html += `<div style="font-size:11px;color:var(--text-muted);word-break:break-all;line-height:1.5">${escapeHtml(info.path)}</div>`;
	html += `</div>`;

	body.innerHTML = html;
}

$("infoPanelClose").addEventListener("click", closeInfoPanel);
$("infoPanelBackdrop").addEventListener("click", closeInfoPanel);

document.addEventListener("keydown", (e) => {
	if (e.key === "Escape" && infoPanelOpen) {
		e.preventDefault();
		closeInfoPanel();
		return;
	}

	// Close settings overlay on Escape (small screens)
	if (e.key === "Escape" && $("settingsSection").classList.contains("settings-open")) {
		e.preventDefault();
		closeSettingsPanel();
		return;
	}

	// T005 — Global keyboard shortcuts
	const activeScreen = document.querySelector(".screen.active");
	const isResults = activeScreen?.id === "screen-results";
	const isModalOpen = !$("modal-delete").classList.contains("hidden") || !$("modal-clean").classList.contains("hidden");
	const isInputFocused = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement || document.activeElement instanceof HTMLSelectElement;

	if (isModalOpen || isInputFocused) return;

	if (e.key === "Backspace" && isResults) {
		e.preventDefault();
		if (navigationStack.length > 1) {
			navigationStack.pop();
			renderResults(navigationStack[navigationStack.length - 1]!);
		} else {
			showScreen("welcome");
			renderCacheList();
		}
		return;
	}

	if (e.key === "Escape" && isResults) {
		e.preventDefault();
		showScreen("welcome");
		renderCacheList();
		return;
	}
});

// --- Stats Widget (Canvas 2D sparkline bar chart) ---
let statsAnimId2: number | null = null;

async function renderStatsWidget() {
	const widget = $("statsWidget");
	const tr = t();

	let stats: { entries: { date: string; freedBytes: number; deleteCount: number }[]; totalFreed: number; totalDeleted: number } | null = null;
	try {
		stats = await electrobun.rpc?.request?.getStats({ days: 14 }) ?? null;
	} catch { /* ignore */ }

	if (!stats || stats.totalFreed === 0) {
		widget.classList.add("hidden");
		if (statsAnimId2) { cancelAnimationFrame(statsAnimId2); statsAnimId2 = null; }
		return;
	}

	widget.classList.remove("hidden");
	$("statsWidgetTitle").textContent = tr.statsTitle;
	$("statsWidgetTotal").textContent = formatSize(stats.totalFreed);

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

			if (d.freedBytes > 0) {
				const intensity = d.freedBytes / maxBytes;
				const r = Math.round(108 + (85 - 108) * intensity);
				const g = Math.round(92 + (239 - 92) * intensity);
				const b = Math.round(231 + (196 - 231) * intensity);
				ctx.fillStyle = `rgba(${r},${g},${b},0.85)`;
			} else {
				ctx.fillStyle = "rgba(255,255,255,0.06)";
			}

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

			if (d.freedBytes === 0) {
				ctx.fillStyle = "rgba(255,255,255,0.06)";
				ctx.fillRect(x, h - 2, barWidth, 2);
			}
		}

		if (globalProgress < 1) {
			statsAnimId2 = requestAnimationFrame(drawFrame);
		} else {
			statsAnimId2 = null;
		}
	}

	statsAnimId2 = requestAnimationFrame(drawFrame);
}

// --- Init ---
populateLanguageSelector();
applyTranslations();
renderCacheList();
loadSettingsUI();
renderStatsWidget();

// --- Version label ---
(async () => {
	try {
		const info = await electrobun.rpc?.request?.getAppVersion({});
		const label = document.getElementById("versionLabel");
		if (label && info?.version) {
			label.textContent = `v${info.version}`;
		}
	} catch {}
})();
