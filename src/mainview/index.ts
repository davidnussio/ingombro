import Electrobun, { Electroview } from "electrobun/view";

// --- Types ---
interface DirEntry {
	path: string;
	name: string;
	size: number;
	children?: DirEntry[];
	isDir: boolean;
}

type AppRPC = {
	bun: {
		requests: {
			scanDirectory: { params: { dirPath: string }; response: { success: boolean; error?: string } };
			getChildren: { params: { dirPath: string }; response: { children: DirEntry[] } };
			deleteEntry: { params: { entryPath: string }; response: { success: boolean; error?: string } };
			getCacheList: { params: {}; response: { entries: { rootPath: string; timestamp: number }[] } };
			deleteCacheEntry: { params: { rootPath: string }; response: { success: boolean } };
			listDir: { params: { partial: string }; response: { suggestions: string[] } };
			validatePath: { params: { dirPath: string }; response: { valid: boolean } };
			getSettings: { params: {}; response: { maxCacheEntries: number; deleteMode: string } };
			saveSettings: { params: { maxCacheEntries: number; deleteMode: string }; response: { success: boolean } };
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
};

const rpc = Electroview.defineRPC<AppRPC>({
	maxRequestTime: 300000,
	handlers: {
		requests: {},
		messages: {
			scanProgress: ({ currentDir, dirs, files }) => {
				const el = document.getElementById("scanStatus");
				if (el) el.textContent = `${dirs} directory · ${files} file scansionati`;
				const dirEl = document.getElementById("scanCurrentDir");
				if (dirEl) dirEl.textContent = currentDir;
			},
			scanComplete: ({ tree }) => {
				const wasInResults = currentTree !== null && navigationStack.length > 0;
				currentTree = tree;

				if (wasInResults) {
					// Rebuild navigation stack preserving current position
					const oldPaths = navigationStack.map((e) => e.path);
					const newStack: DirEntry[] = [tree];
					for (let i = 1; i < oldPaths.length; i++) {
						const parent = newStack[newStack.length - 1]!;
						const child = (parent.children || []).find((c) => c.path === oldPaths[i]);
						if (child) {
							newStack.push(child);
						} else {
							break; // deleted entry or path no longer exists
						}
					}
					navigationStack = newStack;
					renderResults(navigationStack[navigationStack.length - 1]!);
				} else {
					navigationStack = [tree];
					showScreen("results");
					renderResults(tree);
				}
			},
			error: ({ message }) => {
				alert("Errore: " + message);
				showScreen("welcome");
			},
		},
	},
});

const electrobun = new Electrobun.Electroview({ rpc });

// --- State ---
let currentTree: DirEntry | null = null;
let navigationStack: DirEntry[] = [];
let pendingDeletePath: string | null = null;
let pendingDeleteSize: number = 0;
let totalFreedBytes: number = 0;
let toastTimeout: ReturnType<typeof setTimeout> | null = null;

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
	} else {
		settings.classList.add("hidden");
	}
}

// --- Format size ---
function formatSize(bytes: number): string {
	if (bytes === 0) return "0 B";
	const units = ["B", "KB", "MB", "GB", "TB"];
	const i = Math.floor(Math.log(bytes) / Math.log(1024));
	const val = bytes / Math.pow(1024, i);
	return `${val.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
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
	// Treemap area bounds (2px padding from container edge)
	const pad = 2;
	const containerR = 12;
	const innerR = containerR - pad; // 10px for corner rects
	const defaultR = 4;
	const edgeTolerance = 1; // px tolerance for edge detection

	for (const r of rects) {
		ctx.fillStyle = r.color;
		ctx.globalAlpha = 0.85 * alpha;

		// Determine which edges this rect touches
		const w = canvasW || 9999;
		const h = canvasH || 9999;
		const touchTop = r.y <= pad + edgeTolerance;
		const touchLeft = r.x <= pad + edgeTolerance;
		const touchBottom = (r.y + r.h) >= h - pad - edgeTolerance;
		const touchRight = (r.x + r.w) >= w - pad - edgeTolerance;

		// Per-corner radius: [top-left, top-right, bottom-right, bottom-left]
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

	// Capture previous frame before resizing canvas
	let prevSnapshot: ImageBitmap | null = null;
	if (shouldAnimate && canvas.width > 0 && canvas.height > 0) {
		const offscreen = new OffscreenCanvas(canvas.width, canvas.height);
		const offCtx = offscreen.getContext("2d")!;
		offCtx.drawImage(canvas, 0, 0);
		// Store as ImageData for sync drawing
		prevSnapshot = null; // we'll use offscreen directly
		var prevOffscreen = offscreen;
		var prevW = parseFloat(canvas.style.width);
		var prevH = parseFloat(canvas.style.height);
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

	// Animate crossfade
	if (treemapAnimId) cancelAnimationFrame(treemapAnimId);
	const duration = 250;
	const start = performance.now();

	function animateFrame(now: number) {
		const elapsed = now - start;
		const t = Math.min(elapsed / duration, 1);
		// Ease out cubic
		const ease = 1 - Math.pow(1 - t, 3);

		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, canvas.width, canvas.height);

		// Draw old frame fading out
		if (prevOffscreen) {
			ctx.globalAlpha = 1 - ease;
			ctx.drawImage(prevOffscreen, 0, 0, prevOffscreen.width, prevOffscreen.height, 0, 0, canvas.width, canvas.height);
			ctx.globalAlpha = 1;
		}

		// Draw new frame fading in with slight scale
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
			// Final clean render
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
		// If children are not loaded yet, fetch them on demand
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
}

function renderDirList(entries: DirEntry[], parentSize: number) {
	const list = $("dirList");
	list.innerHTML = "";

	for (const entry of entries) {
		const pct = parentSize > 0 ? (entry.size / parentSize) * 100 : 0;
		const colorIdx = entries.indexOf(entry);
		const item = document.createElement("div");
		item.className = "dir-item";
		item.innerHTML = `
			<div class="dir-item-icon">${entry.isDir ? "📁" : "📄"}</div>
			<div class="dir-item-info">
				<div class="dir-item-name">${escapeHtml(entry.name)}</div>
				<div class="dir-item-path">${escapeHtml(entry.path)}</div>
			</div>
			<div class="dir-item-bar">
				<div class="dir-item-bar-fill" style="width:${pct}%;background:${getColor(colorIdx)}"></div>
			</div>
			<div class="dir-item-size">${formatSize(entry.size)}</div>
			<div class="dir-item-actions">
				<button class="btn-delete" data-path="${escapeAttr(entry.path)}" data-name="${escapeAttr(entry.name)}" data-size="${entry.size}">Elimina</button>
			</div>
		`;

		if (entry.isDir) {
			item.addEventListener("click", async (e) => {
				if ((e.target as HTMLElement).classList.contains("btn-delete")) return;
				// If children are not loaded yet (deep directories), fetch them on demand
				if (!entry.children || entry.children.length === 0) {
					try {
						const res = await electrobun.rpc?.request?.getChildren({ dirPath: entry.path });
						if (res && res.children && res.children.length > 0) {
							entry.children = res.children;
							entry.size = res.children.reduce((s: number, c: DirEntry) => s + c.size, 0);
						} else {
							return; // truly empty directory, nothing to navigate into
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
			$("deleteMessage").textContent = `Sei sicuro di voler eliminare "${name}" (${formatSize(size)})? Questa azione è irreversibile.`;
			$("modal-delete").classList.remove("hidden");
		});
	});
}

function escapeHtml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escapeAttr(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

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
	showScreen("scanning");
	electrobun.rpc?.request?.scanDirectory({ dirPath });
});

$("btnRescan").addEventListener("click", () => {
	const dirPath = scanPathInput.value.trim();
	showScreen("scanning");
	electrobun.rpc?.request?.scanDirectory({ dirPath });
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
		const dateStr = date.toLocaleDateString("it-IT", {
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
				<button class="btn btn-sm btn-secondary cache-card-btn" data-action="open" data-path="${escapeAttr(entry.rootPath)}">Apri cache</button>
				<button class="btn btn-sm btn-primary cache-card-btn" data-action="rescan" data-path="${escapeAttr(entry.rootPath)}">Scansiona</button>
			</div>
			<button class="cache-card-delete" data-action="delete-cache" data-path="${escapeAttr(entry.rootPath)}" title="Rimuovi">×</button>
		`;
		container.appendChild(card);
	}
	container.querySelectorAll("[data-action='open']").forEach((btn) => {
		btn.addEventListener("click", async (e) => {
			const path = (e.currentTarget as HTMLElement).dataset.path!;
			scanPathInput.value = path;
			showScreen("scanning");
			const res = await electrobun.rpc?.request?.getChildren({ dirPath: path });
			if (res && res.children) {
				const tree: DirEntry = {
					path, name: path.split("/").pop() || path,
					size: res.children.reduce((s: number, c: DirEntry) => s + c.size, 0),
					isDir: true, children: res.children,
				};
				currentTree = tree;
				navigationStack = [tree];
				showScreen("results");
				renderResults(tree);
			}
		});
	});
	container.querySelectorAll("[data-action='rescan']").forEach((btn) => {
		btn.addEventListener("click", (e) => {
			const path = (e.currentTarget as HTMLElement).dataset.path!;
			scanPathInput.value = path;
			showScreen("scanning");
			electrobun.rpc?.request?.scanDirectory({ dirPath: path });
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
		alert("Errore durante l'eliminazione: " + (result.error || "sconosciuto"));
	} else {
		totalFreedBytes += deletedSize;
		showFreedToast(deletedSize);
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
	// Force reflow for re-trigger
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
		scanPathLabel.textContent = "Directory da scansionare";
		scanPathLabel.style.color = "";
		return;
	}
	const result = await electrobun.rpc?.request?.validatePath({ dirPath: dirPath.trim() });
	if (result?.valid) {
		btnScan.disabled = false;
		scanPathLabel.textContent = "Directory da scansionare";
		scanPathLabel.style.color = "";
	} else {
		btnScan.disabled = true;
		scanPathLabel.textContent = "La directory non esiste";
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

	// Cmd+Enter (Mac) / Ctrl+Enter (other) → avvia scansione
	if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
		e.preventDefault();
		acList.classList.add("hidden");
		if (!btnScan.disabled) btnScan.click();
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
			// Close autocomplete and let the scan happen
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
	// Small delay to allow click on item
	setTimeout(() => acList.classList.add("hidden"), 150);
});

scanPathInput.addEventListener("focus", () => {
	if (scanPathInput.value) fetchSuggestions(scanPathInput.value);
});

// --- Settings ---
const settingMaxCache = $("settingMaxCache") as HTMLInputElement;
const settingDeleteMode = $("settingDeleteMode") as HTMLSelectElement;
let settingsSaveDebounce: ReturnType<typeof setTimeout> | null = null;

async function loadSettingsUI() {
	const settings = await electrobun.rpc?.request?.getSettings({});
	if (settings) {
		settingMaxCache.value = String(settings.maxCacheEntries);
		settingDeleteMode.value = settings.deleteMode;
	}
}

function saveSettingsDebounced() {
	if (settingsSaveDebounce) clearTimeout(settingsSaveDebounce);
	settingsSaveDebounce = setTimeout(async () => {
		await electrobun.rpc?.request?.saveSettings({
			maxCacheEntries: Number(settingMaxCache.value) || 10,
			deleteMode: settingDeleteMode.value,
		});
	}, 400);
}

settingMaxCache.addEventListener("change", saveSettingsDebounced);
settingMaxCache.addEventListener("input", saveSettingsDebounced);
settingDeleteMode.addEventListener("change", saveSettingsDebounced);

// --- Init ---
renderCacheList();
loadSettingsUI();
