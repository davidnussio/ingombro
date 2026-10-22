import { dirname } from "path";
import { BoxRenderable, TextRenderable, type CliRenderer, type KeyEvent } from "@opentui/core";
import {
	type AppSettings,
	type CacheEntry,
	type CancelToken,
	type Category,
	type CleanableItem,
	type DirEntry,
	type EntryInfo,
	type ScanProgress,
	ScanCancelledError,
	batchDelete,
	deleteCacheEntry,
	detectCleanables,
	expandPath,
	findCacheEntry,
	findNode,
	formatAgo,
	formatDate,
	formatSize,
	getEntryInfo,
	getStats,
	isDirectory,
	listCacheEntries,
	listDirSuggestions,
	loadCacheStore,
	loadSettings,
	prettyPath,
	recordDeletion,
	removeDirFromCacheEntry,
	revealInFinder,
	saveCacheStore,
	saveSettings,
	scanDirectory,
	throttledProgress,
	upsertCacheEntry,
} from "../core";
import { T, fmt } from "./i18n";
import { barColor, theme } from "./theme";
import {
	type Line,
	type Seg,
	bar,
	clampScroll,
	fitLine,
	padLeft,
	sanitize,
	toStyled,
	truncate,
	truncateLeft,
} from "./text";

// ─── Types ──────────────────────────────────────────────────────────────────

export type PanelId = "scans" | "clean" | "files" | "info";
const PANELS: PanelId[] = ["scans", "clean", "files", "info"];
const PANEL_NUM: Record<PanelId, number> = { scans: 1, clean: 2, files: 3, info: 4 };
const CATEGORIES: (Category | "all")[] = ["all", "dev", "ml", "office", "design", "video", "music", "secrets"];
const SPINNER = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";

interface ListState {
	cursor: number;
	scroll: number;
	filter: string;
}

type Modal =
	| { kind: "confirm"; title: string; lines: Line[]; onYes: () => void }
	| { kind: "prompt"; title: string; value: string; cycle: string[] | null; cycleIdx: number }
	| { kind: "help" };

interface Toast {
	text: string;
	color: string;
	until: number;
}

interface ScanList {
	rootPath: string;
	timestamp: number;
	size: number;
}

export interface AppOptions {
	/** Path given on the command line. */
	initialPath?: string;
	/** Force a fresh scan even if the path is cached. */
	rescan?: boolean;
	/** Called after the renderer is destroyed. */
	onExit?: () => void;
}

// ─── App ────────────────────────────────────────────────────────────────────

export class App {
	private r: CliRenderer;
	private boxes = {} as Record<PanelId, BoxRenderable>;
	private texts = {} as Record<PanelId, TextRenderable>;
	private status: TextRenderable;
	private modalBox: BoxRenderable;
	private modalText: TextRenderable;

	// state
	focus: PanelId = "files";
	entry: CacheEntry | null = null;
	cwd = "";
	settings!: AppSettings;
	scans: ScanList[] = [];
	freed30 = 0;
	sortBy: "size" | "name" = "size";
	lists: Record<"scans" | "clean" | "files", ListState> = {
		scans: { cursor: 0, scroll: 0, filter: "" },
		clean: { cursor: 0, scroll: 0, filter: "" },
		files: { cursor: 0, scroll: 0, filter: "" },
	};
	infoScroll = 0;
	cursorMemo = new Map<string, number>();
	marked = new Set<string>();
	cleanSelected = new Set<string>();
	cleanCategory: Category | "all" = "all";
	filterEditing: "scans" | "clean" | "files" | null = null;
	modal: Modal | null = null;
	toast: Toast | null = null;
	scanning: { path: string; progress: ScanProgress; cancel: CancelToken; started: number } | null = null;
	detecting: { cancel: CancelToken; current: string } | null = null;
	busy: string | null = null;
	infoCache = new Map<string, EntryInfo | null>();
	private infoTimer: ReturnType<typeof setTimeout> | null = null;
	private ticker: ReturnType<typeof setInterval> | null = null;
	private frame = 0;
	private lastInfoKey = "";
	private exiting = false;

	constructor(
		renderer: CliRenderer,
		private opts: AppOptions = {},
	) {
		this.r = renderer;
		for (const id of PANELS) {
			const box = new BoxRenderable(renderer, {
				id: `panel-${id}`,
				position: "absolute",
				border: true,
				borderStyle: "rounded",
				borderColor: theme.border,
				backgroundColor: theme.bg,
				titleColor: theme.title,
			});
			const text = new TextRenderable(renderer, { width: "100%", height: "100%", wrapMode: "none", content: "" });
			box.add(text);
			renderer.root.add(box);
			this.boxes[id] = box;
			this.texts[id] = text;
		}
		this.status = new TextRenderable(renderer, { position: "absolute", left: 0, height: 1, wrapMode: "none", content: "" });
		renderer.root.add(this.status);
		this.modalBox = new BoxRenderable(renderer, {
			position: "absolute",
			border: true,
			borderStyle: "rounded",
			borderColor: theme.borderFocus,
			backgroundColor: theme.modalBg,
			titleColor: theme.titleFocus,
			zIndex: 100,
			visible: false,
		});
		this.modalText = new TextRenderable(renderer, { width: "100%", height: "100%", wrapMode: "none", content: "" });
		this.modalBox.add(this.modalText);
		renderer.root.add(this.modalBox);

		renderer.keyInput.on("keypress", (k) => this.onKey(k));
		renderer.keyInput.on("paste", (e) => this.onPaste(new TextDecoder().decode(e.bytes)));
		renderer.on("resize", () => this.render());
	}

	async start() {
		this.settings = await loadSettings();
		await this.refreshScans();
		this.render();

		const p = this.opts.initialPath;
		if (p) {
			const resolved = expandPath(p);
			if (!isDirectory(resolved)) {
				this.notify(fmt(T.notDir, { path: p }), theme.err);
			} else if (!this.opts.rescan && this.scans.some((s) => s.rootPath === resolved)) {
				await this.loadScan(resolved);
			} else {
				void this.startScan(resolved);
			}
		} else if (this.scans[0]) {
			await this.loadScan(this.scans[0].rootPath);
		} else {
			this.openScanPrompt();
		}
		this.render();
	}

	// ─── Data helpers ──────────────────────────────────────────────────────

	private get cwdNode(): DirEntry | null {
		if (!this.entry) return null;
		return findNode(this.entry.tree, this.cwd) ?? this.entry.tree;
	}

	fileRows(): DirEntry[] {
		const node = this.cwdNode;
		if (!node?.children) return [];
		let rows = node.children;
		const f = this.lists.files.filter.toLowerCase();
		if (f) rows = rows.filter((c) => c.name.toLowerCase().includes(f));
		if (this.sortBy === "name") {
			rows = [...rows].sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name));
		}
		return rows;
	}

	cleanRows(): CleanableItem[] {
		const all = this.entry?.cleanables?.items ?? [];
		const scope = this.cwd;
		const f = this.lists.clean.filter.toLowerCase();
		return all.filter(
			(i) =>
				(scope === this.entry?.rootPath || i.path.startsWith(scope + "/")) &&
				(this.cleanCategory === "all" || i.category === this.cleanCategory) &&
				(!f || i.path.toLowerCase().includes(f) || i.projectType.toLowerCase().includes(f)),
		);
	}

	scanRows(): ScanList[] {
		const f = this.lists.scans.filter.toLowerCase();
		return f ? this.scans.filter((s) => s.rootPath.toLowerCase().includes(f)) : this.scans;
	}

	private async refreshScans() {
		this.scans = listCacheEntries(await loadCacheStore());
		this.freed30 = (await getStats(30)).totalFreed;
	}

	private rowCount(id: "scans" | "clean" | "files"): number {
		return id === "files" ? this.fileRows().length : id === "clean" ? this.cleanRows().length : this.scanRows().length;
	}

	// ─── Actions ───────────────────────────────────────────────────────────

	notify(text: string, color: string = theme.ok, ms = 4000) {
		this.toast = { text, color, until: Date.now() + ms };
		this.render();
		setTimeout(() => this.render(), ms + 50);
	}

	private startTicker() {
		if (this.ticker) return;
		this.ticker = setInterval(() => {
			this.frame++;
			if (!this.scanning && !this.detecting && !this.busy) {
				clearInterval(this.ticker!);
				this.ticker = null;
			}
			this.render();
		}, 100);
	}

	async startScan(path: string) {
		const resolved = expandPath(path);
		if (!isDirectory(resolved)) {
			this.notify(fmt(T.notDir, { path }), theme.err);
			return;
		}
		if (this.scanning) this.scanning.cancel.cancelled = true;
		if (this.detecting) this.detecting.cancel.cancelled = true;
		const cancel: CancelToken = { cancelled: false };
		this.scanning = { path: resolved, progress: { dirs: 0, files: 0, currentDir: resolved }, cancel, started: Date.now() };
		this.focus = "files";
		this.startTicker();
		this.render();
		try {
			const { tree } = await scanDirectory(resolved, {
				maxDepth: this.settings.maxDepth,
				cancel,
				onProgress: throttledProgress((p) => {
					if (this.scanning) this.scanning.progress = { ...p };
				}, 80),
			});
			const elapsed = (Date.now() - (this.scanning?.started ?? Date.now())) / 1000;
			const entry: CacheEntry = { timestamp: Date.now(), rootPath: resolved, tree };
			const store = await loadCacheStore();
			await saveCacheStore(await upsertCacheEntry(store, entry));
			this.scanning = null;
			this.setEntry(entry);
			await this.refreshScans();
			this.lists.scans.cursor = Math.max(0, this.scans.findIndex((s) => s.rootPath === resolved));
			this.notify(fmt(T.scanDone, { size: formatSize(tree.size), time: `${elapsed.toFixed(1)}s` }));
			void this.runDetect();
		} catch (e) {
			if (this.scanning?.cancel === cancel) this.scanning = null;
			if (e instanceof ScanCancelledError) this.notify(T.scanCancelled, theme.warn);
			else this.notify(String((e as Error).message ?? e), theme.err);
		}
	}

	private setEntry(entry: CacheEntry) {
		this.entry = entry;
		this.cwd = entry.rootPath;
		this.lists.files = { cursor: 0, scroll: 0, filter: "" };
		this.lists.clean = { cursor: 0, scroll: 0, filter: "" };
		this.cursorMemo.clear();
		this.marked.clear();
		this.cleanSelected.clear();
		this.infoCache.clear();
	}

	async loadScan(rootPath: string) {
		const entry = findCacheEntry(await loadCacheStore(), rootPath);
		if (!entry) return;
		this.setEntry(entry);
		this.lists.scans.cursor = Math.max(0, this.scans.findIndex((s) => s.rootPath === rootPath));
		this.render();
		if (!entry.cleanables) void this.runDetect();
	}

	async runDetect() {
		const entry = this.entry;
		if (!entry) return;
		if (this.detecting) this.detecting.cancel.cancelled = true;
		const cancel: CancelToken = { cancelled: false };
		this.detecting = { cancel, current: entry.rootPath };
		this.startTicker();
		const result = await detectCleanables(entry.rootPath, {
			cancel,
			onDir: (d) => {
				if (this.detecting?.cancel === cancel) this.detecting.current = d;
			},
		});
		if (cancel.cancelled) return;
		this.detecting = null;
		entry.cleanables = result;
		const store = await loadCacheStore();
		const stored = findCacheEntry(store, entry.rootPath);
		if (stored) {
			stored.cleanables = result;
			await saveCacheStore(store);
		}
		this.render();
	}

	private enterDir(node: DirEntry) {
		if (!node.isDir) return;
		this.cursorMemo.set(this.cwd, this.lists.files.cursor);
		this.cwd = node.path;
		this.lists.files = { cursor: this.cursorMemo.get(node.path) ?? 0, scroll: 0, filter: "" };
		this.lists.clean.cursor = 0;
	}

	private goUp() {
		if (!this.entry || this.cwd === this.entry.rootPath) return;
		const prev = this.cwd;
		this.cursorMemo.set(this.cwd, this.lists.files.cursor);
		this.cwd = dirname(this.cwd);
		this.lists.files = { cursor: 0, scroll: 0, filter: "" };
		const idx = this.fileRows().findIndex((r) => r.path === prev);
		this.lists.files.cursor = Math.max(0, idx);
		this.lists.clean.cursor = 0;
	}

	private goTo(path: string, select?: string) {
		if (!this.entry) return;
		const node = findNode(this.entry.tree, path);
		if (!node?.isDir) return;
		this.cursorMemo.set(this.cwd, this.lists.files.cursor);
		this.cwd = node.path;
		this.lists.files = { cursor: 0, scroll: 0, filter: "" };
		if (select) this.lists.files.cursor = Math.max(0, this.fileRows().findIndex((r) => r.path === select));
	}

	private confirmDelete(targets: { path: string; size: number; risk?: string }[]) {
		if (!targets.length) return;
		const total = targets.reduce((s, t) => s + t.size, 0);
		const permanent = this.settings.deleteMode === "permanent";
		const lines: Line[] = [
			[
				[permanent ? T.confirmDelete : T.confirmMove, { fg: permanent ? theme.err : theme.warn, bold: true }],
				[`  ${targets.length} ${T.items} · `, { fg: theme.text }],
				[formatSize(total), { fg: theme.size, bold: true }],
			],
			[],
		];
		for (const t of targets.slice(0, 8)) {
			lines.push([
				["  ", {}],
				[t.risk ? "● " : "", { fg: theme.risk[t.risk ?? "low"] }],
				[padLeft(formatSize(t.size), 9) + "  ", { fg: theme.size }],
				[prettyPath(t.path), { fg: theme.text }],
			]);
		}
		if (targets.length > 8) lines.push([[`  ${fmt(T.andMore, { n: targets.length - 8 })}`, { fg: theme.dim }]]);
		if (targets.some((t) => t.risk === "high")) {
			lines.push([], [[`  ⚠ ${T.highRisk}`, { fg: theme.err, bold: true }]]);
		}
		lines.push([], [[T.yesNo, { fg: theme.dim }]]);
		this.modal = { kind: "confirm", title: T.confirmTitle, lines, onYes: () => void this.doDelete(targets) };
		this.render();
	}

	private async doDelete(targets: { path: string; size: number }[]) {
		const entry = this.entry;
		this.busy = `0/${targets.length}`;
		this.startTicker();
		const knownSizes = new Map(targets.map((t) => [t.path, t.size]));
		const res = await batchDelete(
			targets.map((t) => t.path),
			{ knownSizes, onItem: (_, i) => (this.busy = `${i + 1}/${targets.length}`) },
		);
		this.busy = null;
		if (entry) for (const p of res.deletedPaths) removeDirFromCacheEntry(entry, p);
		for (const p of res.deletedPaths) {
			this.marked.delete(p);
			this.cleanSelected.delete(p);
			this.infoCache.delete(p);
		}
		if (res.deletedCount > 0) await recordDeletion(res.deletedSize, res.deletedCount);
		await this.refreshScans();
		if (res.errors.length) {
			this.notify(fmt(T.deleteErrors, { n: res.errors.length, first: res.errors[0]! }), theme.err, 6000);
		} else {
			this.notify(fmt(T.deleted, { size: formatSize(res.deletedSize), n: res.deletedCount }));
		}
	}

	openScanPrompt(initial?: string) {
		const start = initial ?? (this.entry ? prettyPath(this.cwd) + "/" : "~/");
		this.modal = { kind: "prompt", title: T.promptScan, value: start, cycle: null, cycleIdx: -1 };
		this.render();
	}

	async quit() {
		if (this.exiting) return;
		this.exiting = true;
		if (this.scanning) this.scanning.cancel.cancelled = true;
		if (this.detecting) this.detecting.cancel.cancelled = true;
		if (this.ticker) clearInterval(this.ticker);
		this.r.destroy();
		this.opts.onExit?.();
	}

	// ─── Input ─────────────────────────────────────────────────────────────

	private keyId(k: KeyEvent): string {
		if (k.name === "tab" || (k.ctrl && k.name === "i")) return k.shift ? "shift+tab" : "tab";
		if (k.ctrl) return `ctrl+${k.name}`;
		if (k.name === "space") return "space";
		const seq = k.sequence ?? "";
		if (seq && [...seq].length === 1 && !/[\x00-\x1f\x7f]/.test(seq) && !k.meta) return seq;
		return k.name;
	}

	private onPaste(text: string) {
		const clean = text.replace(/[\r\n]+/g, "");
		if (this.modal?.kind === "prompt") {
			this.modal.value += clean;
			this.modal.cycle = null;
		} else if (this.filterEditing) {
			this.lists[this.filterEditing].filter += clean;
			this.lists[this.filterEditing].cursor = 0;
		}
		this.render();
	}

	onKey(k: KeyEvent) {
		const key = this.keyId(k);
		if (key === "ctrl+c") return void this.quit();

		if (this.modal) this.onModalKey(key);
		else if (this.filterEditing) this.onFilterKey(key);
		else this.onMainKey(key);
		this.render();
	}

	private editText(value: string, key: string): string | null {
		if (key === "backspace") return [...value].slice(0, -1).join("");
		if (key === "ctrl+u") return "";
		if (key === "ctrl+w") return value.replace(/[^/\s]+\/?$/, "");
		if (key === "space") return value + " ";
		if ([...key].length === 1) return value + key;
		return null;
	}

	private onModalKey(key: string) {
		const m = this.modal!;
		if (m.kind === "help") {
			if (["escape", "q", "?", "return"].includes(key)) this.modal = null;
			return;
		}
		if (m.kind === "confirm") {
			if (key === "y" || key === "Y" || key === "return") {
				this.modal = null;
				m.onYes();
			} else if (["n", "N", "escape", "q"].includes(key)) {
				this.modal = null;
			}
			return;
		}
		// prompt
		if (key === "escape") {
			this.modal = null;
			return;
		}
		if (key === "return") {
			const value = m.value.trim();
			this.modal = null;
			if (value) void this.startScan(value);
			return;
		}
		if (key === "tab") {
			if (m.cycle && m.cycle.length > 1) {
				m.cycleIdx = (m.cycleIdx + 1) % m.cycle.length;
				m.value = m.cycle[m.cycleIdx]!;
				return;
			}
			const sugg = listDirSuggestions(m.value);
			if (sugg.length === 1) {
				m.value = sugg[0]! + "/";
			} else if (sugg.length > 1) {
				const lcp = commonPrefix(sugg);
				if (lcp.length > m.value.length && !m.value.endsWith("/")) m.value = lcp;
				else {
					m.cycle = sugg;
					m.cycleIdx = 0;
					m.value = sugg[0]!;
				}
			}
			return;
		}
		const next = this.editText(m.value, key);
		if (next !== null) {
			m.value = next;
			m.cycle = null;
		}
	}

	private onFilterKey(key: string) {
		const id = this.filterEditing!;
		const list = this.lists[id];
		if (key === "escape") {
			list.filter = "";
			list.cursor = 0;
			this.filterEditing = null;
			return;
		}
		if (key === "return" || key === "down" || key === "up") {
			this.filterEditing = null;
			return;
		}
		const next = this.editText(list.filter, key);
		if (next !== null) {
			list.filter = next;
			list.cursor = 0;
			list.scroll = 0;
		}
	}

	private moveCursor(id: "scans" | "clean" | "files", delta: number | "top" | "bottom") {
		const list = this.lists[id];
		const n = this.rowCount(id);
		if (n === 0) return;
		if (delta === "top") list.cursor = 0;
		else if (delta === "bottom") list.cursor = n - 1;
		else list.cursor = Math.max(0, Math.min(n - 1, list.cursor + delta));
		this.infoScroll = 0;
	}

	private pageSize(id: PanelId): number {
		return Math.max(1, (this.boxes[id].height as number) - 3);
	}

	private onMainKey(key: string) {
		// Global keys
		switch (key) {
			case "q":
				return void this.quit();
			case "?":
				this.modal = { kind: "help" };
				return;
			case "tab":
			case "]":
				this.focus = PANELS[(PANELS.indexOf(this.focus) + 1) % PANELS.length]!;
				return;
			case "shift+tab":
			case "[":
				this.focus = PANELS[(PANELS.indexOf(this.focus) + PANELS.length - 1) % PANELS.length]!;
				return;
			case "1":
			case "2":
			case "3":
			case "4":
				this.focus = PANELS[Number(key) - 1]!;
				return;
			case "n":
				this.openScanPrompt();
				return;
			case "m":
				this.settings = { ...this.settings, deleteMode: this.settings.deleteMode === "trash" ? "permanent" : "trash" };
				void saveSettings(this.settings);
				this.notify(fmt(T.modeNow, { mode: this.settings.deleteMode === "trash" ? T.modeTrash : T.modePermanent }), this.settings.deleteMode === "trash" ? theme.ok : theme.err);
				return;
			case "escape":
				if (this.scanning) this.scanning.cancel.cancelled = true;
				else if (this.focus !== "info" && this.lists[this.focus].filter) {
					this.lists[this.focus].filter = "";
					this.lists[this.focus].cursor = 0;
				}
				return;
		}

		if (this.focus === "info") {
			if (key === "j" || key === "down") this.infoScroll++;
			else if (key === "k" || key === "up") this.infoScroll = Math.max(0, this.infoScroll - 1);
			else if (key === "g") this.infoScroll = 0;
			else if (key === "ctrl+d" || key === "pagedown") this.infoScroll += this.pageSize("info");
			else if (key === "ctrl+u" || key === "pageup") this.infoScroll = Math.max(0, this.infoScroll - this.pageSize("info"));
			return;
		}

		const id = this.focus;
		// List navigation shared by all list panels
		switch (key) {
			case "j":
			case "down":
				return this.moveCursor(id, 1);
			case "k":
			case "up":
				return this.moveCursor(id, -1);
			case "g":
			case "home":
				return this.moveCursor(id, "top");
			case "G":
			case "end":
				return this.moveCursor(id, "bottom");
			case "ctrl+d":
			case "pagedown":
				return this.moveCursor(id, Math.ceil(this.pageSize(id) / 2));
			case "ctrl+u":
			case "pageup":
				return this.moveCursor(id, -Math.ceil(this.pageSize(id) / 2));
			case "J":
				this.infoScroll++;
				return;
			case "K":
				this.infoScroll = Math.max(0, this.infoScroll - 1);
				return;
			case "/":
				this.filterEditing = id;
				return;
		}

		if (id === "files") this.onFilesKey(key);
		else if (id === "clean") this.onCleanKey(key);
		else this.onScansKey(key);
	}

	private onFilesKey(key: string) {
		const rows = this.fileRows();
		const cur = rows[this.lists.files.cursor];
		switch (key) {
			case "return":
			case "l":
			case "right":
				if (cur?.isDir) this.enterDir(cur);
				return;
			case "backspace":
			case "h":
			case "left":
				return this.goUp();
			case "space":
				if (!cur) return;
				if (this.marked.has(cur.path)) this.marked.delete(cur.path);
				else this.marked.add(cur.path);
				this.moveCursor("files", 1);
				return;
			case "s":
				this.sortBy = this.sortBy === "size" ? "name" : "size";
				this.lists.files.cursor = 0;
				return;
			case "d":
			case "delete": {
				const sizeOf = (p: string) => (this.entry && findNode(this.entry.tree, p)?.size) || 0;
				const targets = this.marked.size
					? [...this.marked].map((p) => ({ path: p, size: sizeOf(p) }))
					: cur
						? [{ path: cur.path, size: cur.size }]
						: [];
				return this.confirmDelete(targets);
			}
			case "e":
			case "o":
				if (cur) void revealInFinder(cur.path).then((ok) => ok && this.notify(T.revealed));
				return;
			case "r":
				if (this.entry) void this.startScan(this.entry.rootPath);
				return;
		}
	}

	private onCleanKey(key: string) {
		const rows = this.cleanRows();
		const cur = rows[this.lists.clean.cursor];
		switch (key) {
			case "space":
				if (!cur) return;
				if (this.cleanSelected.has(cur.path)) this.cleanSelected.delete(cur.path);
				else this.cleanSelected.add(cur.path);
				this.moveCursor("clean", 1);
				return;
			case "a": {
				const allSel = rows.length > 0 && rows.every((r) => this.cleanSelected.has(r.path));
				for (const r of rows) {
					if (allSel) this.cleanSelected.delete(r.path);
					else this.cleanSelected.add(r.path);
				}
				return;
			}
			case "c":
			case "f":
				this.cleanCategory = CATEGORIES[(CATEGORIES.indexOf(this.cleanCategory) + 1) % CATEGORIES.length]!;
				this.lists.clean.cursor = 0;
				return;
			case "d":
			case "delete": {
				const selected = rows.filter((r) => this.cleanSelected.has(r.path));
				const targets = (selected.length ? selected : cur ? [cur] : []).map((i) => ({ path: i.path, size: i.size, risk: i.risk }));
				return this.confirmDelete(targets);
			}
			case "return":
				if (!cur) return;
				this.goTo(cur.projectPath, cur.path);
				this.focus = "files";
				return;
			case "e":
			case "o":
				if (cur) void revealInFinder(cur.path).then((ok) => ok && this.notify(T.revealed));
				return;
			case "r":
				void this.runDetect();
				return;
		}
	}

	private onScansKey(key: string) {
		const rows = this.scanRows();
		const cur = rows[this.lists.scans.cursor];
		switch (key) {
			case "return":
			case "space":
				if (cur) {
					void this.loadScan(cur.rootPath).then(() => {
						this.focus = "files";
						this.render();
					});
				}
				return;
			case "r":
				if (cur) void this.startScan(cur.rootPath);
				return;
			case "d":
			case "delete":
				if (!cur) return;
				void deleteCacheEntry(cur.rootPath).then(async () => {
					if (this.entry?.rootPath === cur.rootPath) this.entry = null;
					await this.refreshScans();
					this.lists.scans.cursor = Math.min(this.lists.scans.cursor, Math.max(0, this.scans.length - 1));
					this.notify(T.cacheRemoved);
				});
				return;
		}
	}

	// ─── Rendering ─────────────────────────────────────────────────────────

	render() {
		if (this.exiting) return;
		const W = this.r.width;
		const H = this.r.height;
		const mainH = Math.max(3, H - 1);

		const layout: Record<PanelId, { x: number; y: number; w: number; h: number; visible: boolean }> = {} as any;
		if (W < 80 || H < 16) {
			// Narrow terminal: only the focused panel, full screen
			for (const id of PANELS) layout[id] = { x: 0, y: 0, w: W, h: mainH, visible: id === this.focus };
		} else {
			const leftW = Math.max(30, Math.min(60, Math.round(W * 0.36)));
			const rightW = W - leftW;
			const scansH = Math.max(4, Math.min(Math.floor(mainH * 0.35), this.scans.length + 2));
			const filesH = Math.max(8, Math.round(mainH * 0.62));
			layout.scans = { x: 0, y: 0, w: leftW, h: scansH, visible: true };
			layout.clean = { x: 0, y: scansH, w: leftW, h: mainH - scansH, visible: true };
			layout.files = { x: leftW, y: 0, w: rightW, h: filesH, visible: true };
			layout.info = { x: leftW, y: filesH, w: rightW, h: mainH - filesH, visible: true };
		}

		for (const id of PANELS) {
			const l = layout[id];
			const box = this.boxes[id];
			box.visible = l.visible;
			if (!l.visible) continue;
			box.left = l.x;
			box.top = l.y;
			box.width = l.w;
			box.height = l.h;
			const focused = this.focus === id;
			box.borderColor = focused ? theme.borderFocus : theme.border;
			box.titleColor = focused ? theme.titleFocus : theme.title;
			const iw = l.w - 2;
			const ih = l.h - 2;
			const { title, bottom, lines } = this.renderPanel(id, iw, ih, focused);
			box.title = ` [${PANEL_NUM[id]}] ${truncate(title, Math.max(4, l.w - 10))} `;
			box.bottomTitle = bottom ? ` ${truncate(bottom, Math.max(4, l.w - 6))} ` : undefined;
			box.bottomTitleAlignment = "right";
			this.texts[id].content = toStyled(lines.slice(0, ih).map((ln) => fitLine(ln, iw)));
		}

		this.status.top = H - 1;
		this.status.width = W;
		this.status.content = toStyled([this.renderStatus(W)]);
		this.renderModal(W, H);
		this.scheduleInfo();
	}

	private renderPanel(id: PanelId, w: number, h: number, focused: boolean): { title: string; bottom?: string; lines: Line[] } {
		switch (id) {
			case "scans":
				return this.renderScans(w, h, focused);
			case "clean":
				return this.renderClean(w, h, focused);
			case "files":
				return this.renderFiles(w, h, focused);
			case "info":
				return this.renderInfo(w, h);
		}
	}

	private filterBottom(id: "scans" | "clean" | "files"): string | undefined {
		const f = this.lists[id].filter;
		if (this.filterEditing === id) return `/${f}▏`;
		if (f) return `/${f}`;
		return undefined;
	}

	private selBg(focused: boolean) {
		return focused ? theme.selBg : theme.selBgBlur;
	}

	private renderScans(w: number, h: number, focused: boolean) {
		const rows = this.scanRows();
		const list = this.lists.scans;
		list.cursor = Math.min(list.cursor, Math.max(0, rows.length - 1));
		list.scroll = clampScroll(list.cursor, list.scroll, h, rows.length);
		const lines: Line[] = [];
		if (!rows.length) for (const l of wrap(T.noScans, w)) lines.push([[l, { fg: theme.dim }]]);
		for (let i = list.scroll; i < Math.min(rows.length, list.scroll + h); i++) {
			const s = rows[i]!;
			const active = this.entry?.rootPath === s.rootPath;
			const right = `${padLeft(formatSize(s.size), 9)} ${padLeft(ago(s.timestamp), 7)}`;
			const nameW = Math.max(4, w - 2 - right.length - 1);
			const line: Line = [
				[active ? "▸ " : "  ", { fg: theme.borderFocus }],
				[truncateLeft(prettyPath(s.rootPath), nameW).padEnd(nameW), { fg: active ? theme.dir : theme.text, bold: active }],
				[" ", {}],
				[right.slice(0, 9), { fg: theme.size }],
				[right.slice(9), { fg: theme.dim }],
			];
			lines.push(i === list.cursor ? fitLine(line, w, this.selBg(focused)) : line);
		}
		const freed = this.freed30 > 0 ? `${T.freed} ${formatSize(this.freed30)} · 30${T.days}` : undefined;
		return { title: T.scans, bottom: this.filterBottom("scans") ?? freed, lines };
	}

	private renderClean(w: number, h: number, focused: boolean) {
		const rows = this.cleanRows();
		const list = this.lists.clean;
		list.cursor = Math.min(list.cursor, Math.max(0, rows.length - 1));
		list.scroll = clampScroll(list.cursor, list.scroll, h, rows.length);
		const total = rows.reduce((s, i) => s + i.size, 0);
		const lines: Line[] = [];
		const longest = Math.max(6, ...rows.slice(list.scroll, list.scroll + h).map((i) => Bun.stringWidth(i.folderName)));
		const nameW = Math.min(longest, 22, Math.max(6, w - 4 - 1 - 10));

		if (this.detecting && !this.entry?.cleanables) {
			lines.push([[`${SPINNER[this.frame % SPINNER.length]} ${T.detecting}`, { fg: theme.info }]]);
			lines.push([[truncateLeft(prettyPath(this.detecting.current), w), { fg: theme.dim }]]);
		} else if (!this.entry) {
			for (const l of wrap(T.noRoot, w)) lines.push([[l, { fg: theme.dim }]]);
		} else if (!rows.length) {
			lines.push([[T.cleanNone, { fg: theme.dim }]]);
		}

		for (let i = list.scroll; i < Math.min(rows.length, list.scroll + h); i++) {
			const it = rows[i]!;
			const sel = this.cleanSelected.has(it.path);
			const rel = relPath(it.projectPath, this.cwd);
			const sizeS = padLeft(formatSize(it.size), 9);
			let relW = Math.max(0, w - 4 - nameW - 1 - 9 - 1);
			if (relW < 6) relW = 0;
			const line: Line = [
				[sel ? "◉ " : "○ ", { fg: sel ? theme.mark : theme.dim }],
				["● ", { fg: theme.risk[it.risk] }],
				[truncate(it.folderName, nameW).padEnd(relW ? nameW : w - 4 - 9 - 1) + " ", { fg: theme.category[it.category] ?? theme.text, bold: sel }],
				[relW ? truncateLeft(rel || ".", relW).padEnd(relW) + " " : "", { fg: theme.dim }],
				[sizeS, { fg: theme.size }],
			];
			lines.push(i === list.cursor ? fitLine(line, w, this.selBg(focused)) : line);
		}

		const selItems = rows.filter((i) => this.cleanSelected.has(i.path));
		const selSize = selItems.reduce((s, i) => s + i.size, 0);
		const cat = this.cleanCategory === "all" ? T.all : this.cleanCategory;
		const spin = this.detecting && this.entry?.cleanables ? ` ${SPINNER[this.frame % SPINNER.length]}` : "";
		const title = `${T.clean} · ${rows.length} · ${formatSize(total)}${spin}`;
		const bottom =
			this.filterBottom("clean") ?? (selItems.length ? `${selItems.length} ${T.cleanSelected} · ${formatSize(selSize)} · ${cat}` : `${T.category}: ${cat}`);
		return { title, bottom, lines };
	}

	private renderFiles(w: number, h: number, focused: boolean) {
		if (this.scanning) {
			const s = this.scanning;
			const secs = ((Date.now() - s.started) / 1000).toFixed(0);
			return {
				title: `${T.scanning} ${prettyPath(s.path)}`,
				lines: [
					[],
					[[`  ${SPINNER[this.frame % SPINNER.length]} ${T.scanning} `, { fg: theme.info, bold: true }], [prettyPath(s.path), { fg: theme.dir, bold: true }]],
					[],
					[
						[`    ${s.progress.dirs.toLocaleString()}`, { fg: theme.size }],
						[` ${T.dirsWord} · `, { fg: theme.dim }],
						[s.progress.files.toLocaleString(), { fg: theme.size }],
						[` ${T.filesWord} · ${secs}s`, { fg: theme.dim }],
					],
					[[`    ${truncateLeft(prettyPath(s.progress.currentDir), w - 6)}`, { fg: theme.dim }]],
					[],
					[[`    esc `, { fg: theme.borderFocus }], [T.k_cancel, { fg: theme.dim }]],
				] as Line[],
			};
		}
		if (!this.entry) return { title: T.files, lines: wrap(T.noRoot, w).map((l) => [[l, { fg: theme.dim }]] as Line) };

		const node = this.cwdNode!;
		const rows = this.fileRows();
		const list = this.lists.files;
		list.cursor = Math.min(list.cursor, Math.max(0, rows.length - 1));
		list.scroll = clampScroll(list.cursor, list.scroll, h, rows.length);
		const maxSize = Math.max(1, ...rows.map((r) => r.size));
		const parentSize = Math.max(1, node.size);

		const sizeW = 9;
		const pctW = 5;
		const barW = w >= 60 ? Math.max(8, Math.min(28, Math.floor(w * 0.25))) : w >= 44 ? 8 : 0;
		const nameW = Math.max(6, w - 2 - 1 - sizeW - (barW ? barW + 1 : 0) - pctW - 1);

		const lines: Line[] = [];
		if (!rows.length) {
			const f = this.lists.files.filter;
			lines.push([[f ? `${T.noMatch} "${f}"` : T.empty, { fg: theme.dim }]]);
		}
		for (let i = list.scroll; i < Math.min(rows.length, list.scroll + h); i++) {
			const c = rows[i]!;
			const isMarked = this.marked.has(c.path);
			const ratio = c.size / parentSize;
			const b = bar(c.size / maxSize, barW);
			const name = c.isDir ? c.name + "/" : c.name;
			const line: Line = [
				[isMarked ? "● " : "  ", { fg: theme.mark }],
				[truncate(sanitize(name), nameW).padEnd(nameW) + " ", { fg: isMarked ? theme.mark : c.isDir ? theme.dir : theme.file, bold: c.isDir }],
				[padLeft(formatSize(c.size), sizeW) + " ", { fg: theme.size }],
			];
			if (barW) line.push([b.filled, { fg: barColor(ratio) }], [b.empty + " ", { fg: theme.barEmpty }]);
			line.push([padLeft(`${(ratio * 100).toFixed(ratio >= 0.1 ? 0 : 1)}%`, pctW), { fg: theme.dim }]);
			lines.push(i === list.cursor ? fitLine(line, w, this.selBg(focused)) : line);
		}

		const rel = relPath(this.cwd, this.entry.rootPath);
		const crumbs = prettyPath(this.entry.rootPath) + (rel ? "/" + rel : "");
		const title = `${truncateLeft(crumbs, Math.max(10, w - 22))} · ${formatSize(node.size)}`;
		const sortLabel = this.sortBy === "size" ? T.sortSize : T.sortName;
		const markInfo = this.marked.size ? `● ${this.marked.size} · ` : "";
		const pos = rows.length ? `${list.cursor + 1}/${rows.length}` : "0/0";
		return { title, bottom: this.filterBottom("files") ?? `${markInfo}${T.sortedBy}: ${sortLabel} · ${pos}`, lines };
	}

	/** What the details panel is about. */
	private infoTarget(): { kind: "clean"; item: CleanableItem } | { kind: "file"; node: DirEntry } | null {
		if (this.focus === "clean") {
			const item = this.cleanRows()[this.lists.clean.cursor];
			if (item) return { kind: "clean", item };
		}
		if (!this.entry) return null;
		const row = this.fileRows()[this.lists.files.cursor];
		return { kind: "file", node: row ?? this.cwdNode! };
	}

	private scheduleInfo() {
		const t = this.infoTarget();
		const p = t ? (t.kind === "clean" ? t.item.path : t.node.path) : "";
		if (p === this.lastInfoKey) return;
		this.lastInfoKey = p;
		this.infoScroll = 0;
		if (!p || this.infoCache.has(p)) return;
		if (this.infoTimer) clearTimeout(this.infoTimer);
		this.infoTimer = setTimeout(async () => {
			const info = await getEntryInfo(p);
			if (this.infoCache.size > 300) this.infoCache.delete(this.infoCache.keys().next().value!);
			this.infoCache.set(p, info);
			if (this.lastInfoKey === p) this.render();
		}, 60);
	}

	private renderInfo(w: number, h: number) {
		const t = this.infoTarget();
		if (!t) return { title: T.details, lines: [] as Line[] };
		const lines: Line[] = [];
		const labelW = LABEL_W();
		const kv = (k: string, v: string, color: string = theme.text) => {
			lines.push([[`${k.padEnd(labelW)}`, { fg: theme.dim }], [v, { fg: color }]]);
		};
		let title = T.details;
		let path: string;

		if (t.kind === "clean") {
			const it = t.item;
			path = it.path;
			title = `${T.details} · ${it.folderName}`;
			kv(T.path, prettyPath(it.path), theme.text);
			kv(T.size, formatSize(it.size), theme.size);
			kv(T.project, prettyPath(it.projectPath), theme.dir);
			kv(T.type, it.projectType);
			kv(T.category, it.category, theme.category[it.category] ?? theme.text);
			kv(T.risk, it.risk.toUpperCase(), theme.risk[it.risk]);
			if (it.note) {
				const note = it.note === "sensitiveDataFound" ? T.sensitiveDataFound : it.note;
				lines.push([]);
				for (const l of wrap(note, w)) lines.push([[l, { fg: it.risk === "high" ? theme.err : theme.warn }]]);
			}
		} else {
			const n = t.node;
			path = n.path;
			title = `${T.details} · ${sanitize(n.name)}${n.isDir ? "/" : ""}`;
			kv(T.path, prettyPath(n.path));
			kv(T.size, formatSize(n.size), theme.size);
			if (n.isDir && n.children) {
				const dirs = n.children.filter((c) => c.isDir).length;
				kv(T.contents, fmt(T.dirsFiles, { d: dirs, f: n.children.length - dirs }));
			}
		}

		const info = this.infoCache.get(path);
		if (info) {
			kv(T.modified, formatDate(info.modifiedAt));
			kv(T.created, formatDate(info.createdAt));
			if (info.isDir) {
				if (info.largestFile) kv(T.largest, `${sanitize(info.largestFile.name)} (${formatSize(info.largestFile.size)})`);
				if (info.newestFile) kv(T.newest, `${sanitize(info.newestFile.name)} (${ago(info.newestFile.modifiedAt)})`);
				if (info.typeDistribution?.length) {
					lines.push([]);
					const bw = Math.max(10, w - 2);
					const segs: Line = [];
					let used = 0;
					info.typeDistribution.forEach((d, idx) => {
						const last = idx === info.typeDistribution!.length - 1;
						const n = last ? bw - used : Math.max(1, Math.round((d.percentage / 100) * bw));
						if (n <= 0) return;
						segs.push(["█".repeat(Math.min(n, bw - used)), { fg: d.color }]);
						used += Math.min(n, bw - used);
					});
					lines.push([[`${T.types}`, { fg: theme.dim }]]);
					lines.push(segs);
					const legend: Line = [];
					for (const d of info.typeDistribution) legend.push(["■ ", { fg: d.color }], [`${d.label} ${d.percentage}%  `, { fg: theme.text }]);
					lines.push(legend);
				}
			} else if (info.previewType === "text" && info.textPreview) {
				lines.push([], [[`── ${T.preview} `.padEnd(w, "─"), { fg: theme.dim }]]);
				for (const l of info.textPreview.split("\n")) lines.push([[sanitize(l), { fg: theme.text }]]);
			} else if (info.previewType) {
				lines.push([], [[T.noPreview + (info.extension ? ` (${info.extension})` : ""), { fg: theme.dim }]]);
			}
		}

		const maxScroll = Math.max(0, lines.length - h);
		this.infoScroll = Math.min(this.infoScroll, maxScroll);
		const bottom = maxScroll > 0 ? `${this.infoScroll + 1}-${Math.min(lines.length, this.infoScroll + h)}/${lines.length}` : undefined;
		return { title, bottom, lines: lines.slice(this.infoScroll) };
	}

	private hints(): [string, string][] {
		if (this.modal || this.filterEditing) return [];
		if (this.scanning) return [["esc", T.k_cancel]];
		switch (this.focus) {
			case "files":
				return [["↑↓", T.k_move], ["⏎", T.k_open], ["⌫", T.k_back], ["space", T.k_mark], ["d", T.k_delete], ["/", T.k_filter], ["s", T.k_sort], ["e", T.k_reveal], ["r", T.k_rescan], ["n", T.k_scan]];
			case "clean":
				return [["space", T.k_toggle], ["a", T.k_all], ["d", T.k_delete], ["c", T.k_cat], ["⏎", T.k_goto], ["/", T.k_filter], ["r", T.k_detect]];
			case "scans":
				return [["⏎", T.k_load], ["r", T.k_rescan], ["d", T.k_forget], ["n", T.k_scan], ["/", T.k_filter]];
			case "info":
				return [["↑↓", T.k_scroll], ["tab", T.k_panels]];
		}
	}

	private renderStatus(W: number): Line {
		const right: Line = [];
		if (this.busy) right.push([`${SPINNER[this.frame % SPINNER.length]} ${this.busy} `, { fg: theme.warn }]);
		if (this.toast && this.toast.until > Date.now()) right.push([`${this.toast.text} `, { fg: this.toast.color, bold: true }]);
		const permanent = this.settings?.deleteMode === "permanent";
		right.push([permanent ? ` ${T.modePermanent} ` : ` ${T.modeTrash} `, { fg: permanent ? "#ffffff" : theme.dim, bg: permanent ? theme.err : undefined, bold: permanent }]);

		const rightW = right.reduce((n, [t]) => n + Bun.stringWidth(t), 0);
		const left: Line = [];
		let used = 0;
		const hints = this.hints();
		const all: [string, string][] = [...hints, ["?", T.k_help], ["q", T.k_quit]];
		for (const [k, label] of all) {
			const segW = Bun.stringWidth(` ${k} ${label} `);
			if (used + segW > W - rightW - 1) break;
			left.push([` ${k}`, { fg: theme.borderFocus }], [` ${label} `, { fg: theme.dim }]);
			used += segW;
		}
		return [...left, [" ".repeat(Math.max(0, W - used - rightW)), {}], ...right];
	}

	private renderModal(W: number, H: number) {
		const m = this.modal;
		if (!m) {
			this.modalBox.visible = false;
			return;
		}
		let lines: Line[] = [];
		let title = "";
		let w = Math.min(W - 4, 76);
		if (m.kind === "help") {
			title = T.help;
			const sections: [string, [string, string][]][] = [
				[T.globalKeys, [["1-4 / tab", T.k_panels], ["n", T.k_scan], ["m", T.k_mode], ["/", T.k_filter], ["esc", T.k_clearFilter], ["J / K", `${T.details} ${T.k_scroll}`], ["q / ctrl+c", T.k_quit]]],
				[`[3] ${T.files}`, [["j k ↑ ↓ g G", T.k_move], ["⏎ l →", T.k_open], ["⌫ h ←", T.k_back], ["space", T.k_mark], ["d", T.k_delete], ["s", T.k_sort], ["e", T.k_reveal], ["r", T.k_rescan]]],
				[`[2] ${T.clean}`, [["space / a", `${T.k_toggle} / ${T.k_all}`], ["d", T.k_delete], ["c", T.k_cat], ["⏎", T.k_goto], ["r", T.k_detect]]],
				[`[1] ${T.scans}`, [["⏎", T.k_load], ["r", T.k_rescan], ["d", T.k_forget]]],
			];
			const block = (sec: typeof sections): Line[] => {
				const out: Line[] = [];
				for (const [name, keys] of sec) {
					out.push([[name, { fg: theme.titleFocus, bold: true }]]);
					for (const [k, d] of keys) out.push([[`  ${k.padEnd(13)}`, { fg: theme.size }], [d, { fg: theme.text }]]);
					out.push([]);
				}
				return out;
			};
			if (W >= 90) {
				w = Math.min(W - 4, 100);
				const colW = Math.floor((w - 4) / 2);
				const left = block(sections.slice(0, 2));
				const right = block(sections.slice(2));
				for (let i = 0; i < Math.max(left.length, right.length); i++) {
					lines.push([...fitLine(left[i] ?? [], colW), ["  ", {}], ...(right[i] ?? [])]);
				}
			} else {
				lines = block(sections);
			}
			while (lines.length && !lines[lines.length - 1]!.length) lines.pop();
		} else if (m.kind === "confirm") {
			title = m.title;
			lines = m.lines;
		} else {
			title = T.promptScan;
			const sugg = m.cycle ?? listDirSuggestions(m.value);
			lines.push([[`› `, { fg: theme.borderFocus, bold: true }], [truncateLeft(m.value, w - 6), { fg: theme.text, bold: true }], ["▏", { fg: theme.borderFocus }]]);
			lines.push([]);
			for (const [i, s] of sugg.slice(0, 10).entries()) {
				const active = m.cycle && i === m.cycleIdx;
				lines.push([[`  ${truncateLeft(s, w - 6)}`, { fg: active ? theme.titleFocus : theme.dim, bold: !!active }]]);
			}
			if (sugg.length > 10) lines.push([[`  …`, { fg: theme.dim }]]);
			lines.push([], [[T.promptHint, { fg: theme.dim }]]);
		}
		const h = Math.min(H - 2, lines.length + 2);
		this.modalBox.visible = true;
		this.modalBox.width = w;
		this.modalBox.height = h;
		this.modalBox.left = Math.max(0, Math.floor((W - w) / 2));
		this.modalBox.top = Math.max(0, Math.floor((H - h) / 2));
		this.modalBox.title = ` ${title} `;
		this.modalText.content = toStyled(lines.slice(0, h - 2).map((l) => fitLine(l, w - 2)));
	}
}

// ─── Utilities ──────────────────────────────────────────────────────────────

let labelWidth = 0;
/** Width of the key column in the details panel (longest localized label + 2). */
function LABEL_W(): number {
	if (!labelWidth) {
		labelWidth = 2 + Math.max(...[T.path, T.size, T.contents, T.modified, T.created, T.largest, T.newest, T.project, T.type, T.category, T.risk].map((l) => Bun.stringWidth(l)));
	}
	return labelWidth;
}

function ago(ts: number): string {
	return fmt(T.ago, { n: formatAgo(ts).replace(/ ago$/, "") });
}

function relPath(p: string, base: string): string {
	if (p === base) return "";
	return p.startsWith(base + "/") ? p.slice(base.length + 1) : prettyPath(p);
}

function commonPrefix(list: string[]): string {
	if (!list.length) return "";
	let prefix = list[0]!;
	for (const s of list) while (!s.startsWith(prefix)) prefix = prefix.slice(0, -1);
	return prefix;
}

function wrap(text: string, w: number): string[] {
	const out: string[] = [];
	let cur = "";
	for (const word of text.split(/\s+/)) {
		if (cur && Bun.stringWidth(cur + " " + word) > w) {
			out.push(cur);
			cur = word;
		} else cur = cur ? cur + " " + word : word;
	}
	if (cur) out.push(cur);
	return out;
}

export type { Seg };
