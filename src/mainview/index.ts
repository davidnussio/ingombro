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
				currentTree = tree;
				navigationStack = [tree];
				showScreen("results");
				renderResults(tree);
			},
			cacheFound: ({ timestamp, rootPath }) => {
				const date = new Date(timestamp);
				const dateStr = date.toLocaleDateString("it-IT", {
					day: "numeric", month: "long", year: "numeric",
					hour: "2-digit", minute: "2-digit",
				});
				const cacheInfo = document.getElementById("cacheInfo")!;
				const cacheText = document.getElementById("cacheText")!;
				cacheInfo.classList.remove("hidden");
				cacheText.textContent = `Cache trovata: ${rootPath} (${dateStr})`;
				(document.getElementById("scanPath") as HTMLInputElement).value = rootPath;
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

// --- DOM ---
const $ = (id: string) => document.getElementById(id)!;
const scanPathInput = $("scanPath") as HTMLInputElement;

// --- Screens ---
function showScreen(name: "welcome" | "scanning" | "results") {
	document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
	$(`screen-${name}`).classList.add("active");
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

function renderTreemap(entries: DirEntry[]) {
	const canvas = document.getElementById("treemapCanvas") as HTMLCanvasElement;
	const container = document.getElementById("vizContainer")!;
	const rect = container.getBoundingClientRect();
	const dpr = window.devicePixelRatio || 1;

	canvas.width = rect.width * dpr;
	canvas.height = rect.height * dpr;
	canvas.style.width = rect.width + "px";
	canvas.style.height = rect.height + "px";

	const ctx = canvas.getContext("2d")!;
	ctx.scale(dpr, dpr);
	ctx.clearRect(0, 0, rect.width, rect.height);

	const topEntries = entries.filter((e) => e.size > 0).slice(0, 40);
	treemapRects = squarify(topEntries, 2, 2, rect.width - 4, rect.height - 4);

	for (const r of treemapRects) {
		ctx.fillStyle = r.color;
		ctx.globalAlpha = 0.85;
		roundRect(ctx, r.x, r.y, r.w - 1.5, r.h - 1.5, 4);
		ctx.fill();
		ctx.globalAlpha = 1;

		if (r.w > 50 && r.h > 28) {
			ctx.fillStyle = "rgba(255,255,255,0.9)";
			ctx.font = "600 11px -apple-system, system-ui, sans-serif";
			const label = truncateText(ctx, r.entry.name, r.w - 12);
			ctx.fillText(label, r.x + 6, r.y + 16);

			if (r.h > 40) {
				ctx.fillStyle = "rgba(255,255,255,0.55)";
				ctx.font = "10px -apple-system, system-ui, sans-serif";
				ctx.fillText(formatSize(r.entry.size), r.x + 6, r.y + 30);
			}
		}
	}
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.lineTo(x + w - r, y);
	ctx.quadraticCurveTo(x + w, y, x + w, y + r);
	ctx.lineTo(x + w, y + h - r);
	ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
	ctx.lineTo(x + r, y + h);
	ctx.quadraticCurveTo(x, y + h, x, y + h - r);
	ctx.lineTo(x, y + r);
	ctx.quadraticCurveTo(x, y, x + r, y);
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

treemapCanvas.addEventListener("click", (e) => {
	const rect = treemapCanvas.getBoundingClientRect();
	const mx = e.clientX - rect.left;
	const my = e.clientY - rect.top;
	const hit = treemapRects.find((r) => mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h);
	if (hit && hit.entry.isDir && hit.entry.children && hit.entry.children.length > 0) {
		navigationStack.push(hit.entry);
		renderResults(hit.entry);
	}
});

// --- Render results ---
function renderResults(entry: DirEntry) {
	$("currentPath").textContent = entry.name;
	$("totalSize").textContent = formatSize(entry.size);

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

		if (entry.isDir && entry.children && entry.children.length > 0) {
			item.addEventListener("click", (e) => {
				if ((e.target as HTMLElement).classList.contains("btn-delete")) return;
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
			const name = el.dataset.name || "";
			const size = Number(el.dataset.size || 0);
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
	}
});

// --- Scan ---
$("btnScan").addEventListener("click", () => {
	const dirPath = scanPathInput.value.trim();
	showScreen("scanning");
	electrobun.rpc?.request?.scanDirectory({ dirPath });
});

$("btnRescan").addEventListener("click", () => {
	const dirPath = scanPathInput.value.trim();
	showScreen("scanning");
	electrobun.rpc?.request?.scanDirectory({ dirPath });
});

$("btnLoadCache").addEventListener("click", async () => {
	const dirPath = scanPathInput.value.trim();
	showScreen("scanning");
	const result = await electrobun.rpc?.request?.getChildren({ dirPath });
	if (result && result.children) {
		const tree: DirEntry = {
			path: dirPath,
			name: dirPath.split("/").pop() || dirPath,
			size: result.children.reduce((s: number, c: DirEntry) => s + c.size, 0),
			isDir: true,
			children: result.children,
		};
		currentTree = tree;
		navigationStack = [tree];
		showScreen("results");
		renderResults(tree);
	}
});

// --- Delete modal ---
$("btnCancelDelete").addEventListener("click", () => {
	$("modal-delete").classList.add("hidden");
	pendingDeletePath = null;
});

$("modal-delete").querySelector(".modal-backdrop")!.addEventListener("click", () => {
	$("modal-delete").classList.add("hidden");
	pendingDeletePath = null;
});

$("btnConfirmDelete").addEventListener("click", async () => {
	if (!pendingDeletePath) return;
	$("modal-delete").classList.add("hidden");
	const path = pendingDeletePath;
	pendingDeletePath = null;

	const result = await electrobun.rpc?.request?.deleteEntry({ entryPath: path });
	if (result && !result.success) {
		alert("Errore durante l'eliminazione: " + (result.error || "sconosciuto"));
	}
});

// --- Resize handler ---
window.addEventListener("resize", () => {
	if (currentTree && navigationStack.length > 0) {
		const current = navigationStack[navigationStack.length - 1]!;
		const children = (current.children || []).filter((c) => c.size > 0);
		renderTreemap(children);
	}
});

// --- Init: check cache ---
electrobun.rpc?.request?.checkCache({});
