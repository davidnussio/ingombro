import { BrowserView, BrowserWindow, Screen, ApplicationMenu, Updater } from "electrobun/bun";
import { statSync, readdirSync, rmSync, mkdirSync, readFileSync } from "fs";
import { join, basename, resolve, extname } from "path";
import { homedir } from "os";
import { $ } from "bun";

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
	cleanables?: CleanableResult;
}

interface CacheData {
	entries: CacheEntry[];
}

interface AppSettings {
	maxCacheEntries: number;
	deleteMode: "trash" | "permanent";
	maxDepth: number;
}

const DEFAULT_SETTINGS: AppSettings = {
	maxCacheEntries: 10,
	deleteMode: "trash",
	maxDepth: 10,
};

// --- Progress tracking ---
let scanStats = { dirs: 0, files: 0, currentDir: "" };
let scanCancelled = false;

// --- Resolve ~ in paths ---
function expandPath(p: string): string {
	let result: string;
	if (p.startsWith("~/")) result = join(homedir(), p.slice(2));
	else if (p === "~") result = homedir();
	else result = resolve(p);
	// Normalize: remove trailing slash (unless root "/")
	if (result.length > 1 && result.endsWith("/")) result = result.slice(0, -1);
	return result;
}

// --- App directory ---
const APP_DIR = join(homedir(), ".ingombro");
function ensureAppDir() {
	mkdirSync(APP_DIR, { recursive: true });
}

// --- Stats tracking ---
interface StatsEntry {
	date: string; // YYYY-MM-DD
	freedBytes: number;
	deleteCount: number;
}

interface StatsData {
	entries: StatsEntry[];
}

const STATS_FILE = join(APP_DIR, "stats.json");

async function loadStats(): Promise<StatsData> {
	try {
		ensureAppDir();
		if (await Bun.file(STATS_FILE).exists()) {
			const parsed = await Bun.file(STATS_FILE).json();
			return parsed as StatsData;
		}
	} catch {}
	return { entries: [] };
}

async function saveStats(data: StatsData) {
	try {
		ensureAppDir();
		await Bun.write(STATS_FILE, JSON.stringify(data, null, 2));
	} catch (e) {
		console.error("[ingombro] Failed to save stats:", e);
	}
}

async function recordDeletion(freedBytes: number, deleteCount: number) {
	const stats = await loadStats();
	const today = new Date().toISOString().slice(0, 10);
	const existing = stats.entries.find((e) => e.date === today);
	if (existing) {
		existing.freedBytes += freedBytes;
		existing.deleteCount += deleteCount;
	} else {
		stats.entries.push({ date: today, freedBytes, deleteCount });
	}
	// Keep last 90 days max
	stats.entries.sort((a, b) => a.date.localeCompare(b.date));
	if (stats.entries.length > 90) {
		stats.entries = stats.entries.slice(-90);
	}
	await saveStats(stats);
}

// --- Settings ---
const SETTINGS_FILE = join(APP_DIR, "settings.json");

async function loadSettings(): Promise<AppSettings> {
	try {
		ensureAppDir();
		if (await Bun.file(SETTINGS_FILE).exists()) {
			const parsed = await Bun.file(SETTINGS_FILE).json();
			return { ...DEFAULT_SETTINGS, ...parsed };
		}
	} catch {}
	return { ...DEFAULT_SETTINGS };
}

async function saveSettings(settings: AppSettings) {
	try {
		ensureAppDir();
		await Bun.write(SETTINGS_FILE, JSON.stringify(settings, null, 2));
	} catch (e) {
		console.error("[ingombro] Failed to save settings:", e);
	}
}

// --- Cache ---
const CACHE_FILE = join(APP_DIR, "cache.json.gz");
// Migrate old cache file if exists
const OLD_CACHE_FILE = join(homedir(), ".diskscanner_cache.json");
const OLD_CACHE_FILE_UNGZ = join(APP_DIR, "cache.json");
// Migrate from old locations
try {
	const cacheExists = await Bun.file(CACHE_FILE).exists();
	if (!cacheExists) {
		ensureAppDir();
		// Migrate from ~/.diskscanner_cache.json
		if (await Bun.file(OLD_CACHE_FILE).exists()) {
			const oldData = await Bun.file(OLD_CACHE_FILE).text();
			const compressed = Bun.gzipSync(new TextEncoder().encode(oldData));
			await Bun.write(CACHE_FILE, compressed);
			rmSync(OLD_CACHE_FILE, { force: true });
		}
		// Migrate from uncompressed cache.json
		else if (await Bun.file(OLD_CACHE_FILE_UNGZ).exists()) {
			const oldData = await Bun.file(OLD_CACHE_FILE_UNGZ).text();
			const compressed = Bun.gzipSync(new TextEncoder().encode(oldData));
			await Bun.write(CACHE_FILE, compressed);
			rmSync(OLD_CACHE_FILE_UNGZ, { force: true });
		}
	}
} catch {}

async function loadCacheStore(): Promise<CacheData> {
	try {
		const cacheFile = Bun.file(CACHE_FILE);
		if (await cacheFile.exists()) {
			const raw = Bun.gunzipSync(new Uint8Array(await cacheFile.arrayBuffer()));
			const parsed = JSON.parse(new TextDecoder().decode(raw));
			// Migrate old single-entry format
			if (parsed && !parsed.entries && parsed.rootPath) {
				return { entries: [{ timestamp: parsed.timestamp, rootPath: parsed.rootPath, tree: parsed.tree }] };
			}
			return parsed as CacheData;
		}
	} catch {
		// Fallback: try reading as plain JSON (pre-compression migration)
		try {
			const cacheFile = Bun.file(CACHE_FILE);
			if (await cacheFile.exists()) {
				const parsed = await cacheFile.json();
				if (parsed && !parsed.entries && parsed.rootPath) {
					return { entries: [{ timestamp: parsed.timestamp, rootPath: parsed.rootPath, tree: parsed.tree }] };
				}
				return parsed as CacheData;
			}
		} catch {}
	}
	return { entries: [] };
}

function saveCacheStore(data: CacheData) {
	try {
		ensureAppDir();
		const json = JSON.stringify(data);
		// Punto 8: Bun.hash() per tracciare le modifiche alla cache
		console.log(`[cache] Saving cache (hash=${Bun.hash(json).toString(16)}, entries=${data.entries.length})`);
		const compressed = Bun.gzipSync(new TextEncoder().encode(json));
		Bun.write(CACHE_FILE, compressed);
	} catch (e) {
		console.error("[ingombro] Failed to save cache:", e);
	}
}

async function upsertCacheEntry(store: CacheData, entry: CacheEntry): Promise<CacheData> {
	const settings = await loadSettings();
	const filtered = store.entries.filter((e) => e.rootPath !== entry.rootPath);
	filtered.unshift(entry);
	return { entries: filtered.slice(0, settings.maxCacheEntries) };
}

function findCacheEntry(store: CacheData, rootPath: string): CacheEntry | null {
	return store.entries.find((e) => e.rootPath === rootPath) || null;
}

// --- Filesystem Scanner (async with progress) ---
async function scanDirectoryAsync(dirPath: string, depth: number = 0, maxDepth: number = 10, sendProgress: () => Promise<void> = async () => {}): Promise<DirEntry> {
	const name = basename(dirPath) || dirPath;
	const entry: DirEntry = { path: dirPath, name, size: 0, isDir: true, children: [] };

	if (scanCancelled) throw new Error("SCAN_CANCELLED");

	scanStats.dirs++;
	scanStats.currentDir = dirPath;
	await sendProgress();

	try {
		const items = readdirSync(dirPath, { withFileTypes: true });
		for (const item of items) {
			if (scanCancelled) throw new Error("SCAN_CANCELLED");
			if (item.name.startsWith(".") || item.name === "node_modules" || item.name === ".Trash") continue;

			const fullPath = join(dirPath, item.name);
			try {
				if (item.isDirectory()) {
					if (depth < maxDepth) {
						const child = await scanDirectoryAsync(fullPath, depth + 1, maxDepth, sendProgress);
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

// --- Smart Clean: cleanable folder detection ---
type RiskLevel = "low" | "medium" | "high";
type Category = "dev" | "ml" | "office" | "design" | "video" | "music" | "secrets";

interface CleanableItem {
	path: string;
	projectPath: string;
	projectType: string;
	folderName: string;
	size: number;
	risk: RiskLevel;
	category: Category;
	note?: string;
}

interface CleanableResult {
	items: CleanableItem[];
	totalSize: number;
}

interface CleanableRule {
	projectType: string;
	category: Category;
	sentinels: string[];
	risk: RiskLevel;
	note?: string;
	disambig?: string;
}

const CLEANABLE_RULES: Record<string, CleanableRule> = {
	// ── Node / JS ──────────────────────────────────────────────────────────
	node_modules:       { category: "dev", projectType: "Node / Bun",       risk: "low",    sentinels: ["package.json"] },
	".parcel-cache":    { category: "dev", projectType: "Parcel",            risk: "low",    sentinels: ["package.json"] },
	".turbo":           { category: "dev", projectType: "Monorepo",          risk: "low",    sentinels: ["turbo.json"] },
	".nx":              { category: "dev", projectType: "Monorepo",          risk: "low",    sentinels: ["nx.json"] },
	coverage:           { category: "dev", projectType: "Test artifacts",    risk: "low",    sentinels: ["jest.config.js", "vitest.config.ts", ".nycrc"] },
	"storybook-static": { category: "dev", projectType: "Storybook",        risk: "low",    sentinels: [".storybook/main.js", ".storybook/main.ts"] },

	// ── Framework output ───────────────────────────────────────────────────
	".next":            { category: "dev", projectType: "Next.js",           risk: "low",    sentinels: ["next.config.js", "next.config.mjs", "next.config.ts"] },
	".nuxt":            { category: "dev", projectType: "Nuxt",              risk: "low",    sentinels: ["nuxt.config.js", "nuxt.config.ts"] },
	".svelte-kit":      { category: "dev", projectType: "SvelteKit",         risk: "low",    sentinels: ["svelte.config.js", "svelte.config.ts"] },
	".astro":           { category: "dev", projectType: "Astro",             risk: "low",    sentinels: ["astro.config.mjs", "astro.config.ts"] },
	".remix":           { category: "dev", projectType: "Remix",             risk: "low",    sentinels: ["remix.config.js"] },
	".angular":         { category: "dev", projectType: "Angular",           risk: "low",    sentinels: ["angular.json"] },
	".docusaurus":      { category: "dev", projectType: "Docusaurus",        risk: "low",    sentinels: ["docusaurus.config.js"] },
	site:               { category: "dev", projectType: "MkDocs",            risk: "low",    sentinels: ["mkdocs.yml"] },

	// ── Ambiguous — sentinel obbligatorio ─────────────────────────────────
	build: {
		category: "dev", projectType: "Build artifacts", risk: "medium",
		sentinels: ["package.json", "build.gradle", "build.gradle.kts", "CMakeLists.txt", "Makefile"],
		disambig: "Sentinel obbligatorio: non procedere senza conferma",
	},
	dist: {
		category: "dev", projectType: "Build artifacts", risk: "medium",
		sentinels: ["package.json", "pyproject.toml", "setup.py"],
		disambig: "Sentinel obbligatorio: non procedere senza conferma",
	},
	".cache": {
		category: "dev", projectType: "Cache generico", risk: "medium",
		sentinels: [],
		note: "Nessun sentinel — richiedere conferma esplicita",
	},

	// ── target — disambiguato ─────────────────────────────────────────────
	target: {
		category: "dev", projectType: "Rust / Maven", risk: "low",
		sentinels: ["Cargo.toml", "pom.xml"],
		disambig: "Cargo.toml → Rust, pom.xml → Java/Maven",
	},

	// ── Python ────────────────────────────────────────────────────────────
	__pycache__:        { category: "dev", projectType: "Python",            risk: "low",    sentinels: ["requirements.txt", "pyproject.toml", "setup.py", "Pipfile"] },
	".venv":            { category: "dev", projectType: "Python",            risk: "low",    sentinels: ["requirements.txt", "pyproject.toml", "setup.py", "Pipfile"] },
	venv:               { category: "dev", projectType: "Python",            risk: "low",    sentinels: ["requirements.txt", "pyproject.toml", "setup.py", "Pipfile"] },
	".tox":             { category: "dev", projectType: "Python",            risk: "low",    sentinels: ["tox.ini", "pyproject.toml"] },
	".pytest_cache":    { category: "dev", projectType: "Python",            risk: "low",    sentinels: ["pytest.ini", "pyproject.toml", "setup.cfg"] },
	htmlcov:            { category: "dev", projectType: "Python",            risk: "low",    sentinels: ["pyproject.toml", ".coveragerc"] },
	".mypy_cache":      { category: "dev", projectType: "Python",            risk: "low",    sentinels: ["mypy.ini", "pyproject.toml"] },
	".ruff_cache":      { category: "dev", projectType: "Python",            risk: "low",    sentinels: ["ruff.toml", "pyproject.toml"] },

	// ── Java / Kotlin ─────────────────────────────────────────────────────
	".gradle":          { category: "dev", projectType: "Java/Kotlin",       risk: "low",    sentinels: ["build.gradle", "build.gradle.kts", "settings.gradle"] },

	// ── Ruby ──────────────────────────────────────────────────────────────
	".bundle":          { category: "dev", projectType: "Ruby",              risk: "low",    sentinels: ["Gemfile"] },

	// ── Elixir ────────────────────────────────────────────────────────────
	"_build":           { category: "dev", projectType: "Elixir",            risk: "low",    sentinels: ["mix.exs"] },
	deps:               { category: "dev", projectType: "Elixir",            risk: "low",    sentinels: ["mix.exs"] },
	".elixir_ls":       { category: "dev", projectType: "Elixir",            risk: "low",    sentinels: ["mix.exs"] },

	// ── Zig ───────────────────────────────────────────────────────────────
	"zig-cache":        { category: "dev", projectType: "Zig",              risk: "low",    sentinels: ["build.zig"] },
	"zig-out":          { category: "dev", projectType: "Zig",              risk: "low",    sentinels: ["build.zig"] },

	// ── Haskell ───────────────────────────────────────────────────────────
	".stack-work":      { category: "dev", projectType: "Haskell",           risk: "low",    sentinels: ["stack.yaml", "package.yaml"] },

	// ── Infrastructure ────────────────────────────────────────────────────
	".terraform":       { category: "dev", projectType: "Terraform",         risk: "medium", sentinels: ["*.tf", "terraform.tfvars"], note: "Rimuove provider binaries, non i .tfstate" },
	".cdk.out":         { category: "dev", projectType: "AWS CDK",           risk: "low",    sentinels: ["cdk.json"] },
	".serverless":      { category: "dev", projectType: "Serverless",        risk: "low",    sentinels: ["serverless.yml", "serverless.yaml"] },

	// ── Mobile ────────────────────────────────────────────────────────────
	Pods:               { category: "dev", projectType: "iOS",               risk: "low",    sentinels: ["Podfile"] },
	".dart_tool":       { category: "dev", projectType: "Dart/Flutter",      risk: "low",    sentinels: ["pubspec.yaml"] },
	".pub-cache":       { category: "dev", projectType: "Dart/Flutter",      risk: "low",    sentinels: ["pubspec.yaml"] },

	// ── AI / ML ───────────────────────────────────────────────────────────
	".ipynb_checkpoints": { category: "ml", projectType: "Jupyter",          risk: "low",    sentinels: ["*.ipynb"] },
	mlruns:               { category: "ml", projectType: "MLflow",           risk: "medium", sentinels: ["MLproject"], note: "Contiene run history e artifact — può essere molto grande" },
	wandb:                { category: "ml", projectType: "Weights & Biases", risk: "medium", sentinels: ["*.py", "requirements.txt"], note: "Safe se si usa W&B cloud sync" },
	lightning_logs:       { category: "ml", projectType: "PyTorch Lightning", risk: "medium", sentinels: ["*.py"], note: "Checkpoint e TensorBoard logs" },

	// ── Ufficio ───────────────────────────────────────────────────────────
	"Thumbs.db":        { category: "office", projectType: "Windows",        risk: "low",    sentinels: [] },
	".DS_Store":        { category: "office", projectType: "macOS",          risk: "low",    sentinels: [] },
	"Desktop.ini":      { category: "office", projectType: "Windows",        risk: "low",    sentinels: [] },

	// ── Design ────────────────────────────────────────────────────────────
	RECOVER:            { category: "design", projectType: "Illustrator",    risk: "high",   sentinels: ["*.ai"], note: "Eliminare solo dopo aver aperto e salvato il progetto" },
	".affinity-autosave": { category: "design", projectType: "Affinity",     risk: "high",   sentinels: ["*.afdesign", "*.afphoto"], note: "Verificare assenza di sessioni aperte" },
	"Sketch Previews":  { category: "design", projectType: "Sketch",         risk: "low",    sentinels: ["*.sketch"] },

	// ── Video editing ─────────────────────────────────────────────────────
	"Media Cache":      { category: "video", projectType: "Premiere Pro",    risk: "low",    sentinels: ["*.prproj"] },
	"Adobe Premiere Auto-Save": { category: "video", projectType: "Premiere Pro", risk: "high", sentinels: ["*.prproj"], note: "Solo se progetto completato e archiviato" },
	"Render Cache":     { category: "video", projectType: "DaVinci Resolve", risk: "low",    sentinels: ["*.drp"] },
	"Fusion Cache":     { category: "video", projectType: "DaVinci Resolve", risk: "low",    sentinels: ["*.drp"] },
	"Render Files":     { category: "video", projectType: "Final Cut Pro",   risk: "low",    sentinels: ["*.fcpbundle"] },
	"Final Cut Backups": { category: "video", projectType: "Final Cut Pro",  risk: "high",   sentinels: ["*.fcpbundle"], note: "~/Movies/Final Cut Pro/ — backup automatici" },
	proxy:              { category: "video", projectType: "Multi-app",       risk: "medium", sentinels: ["*.prproj", "*.drp", "*.fcpbundle"], note: "Safe solo se il footage originale è intatto" },

	// ── Musica / DAW ──────────────────────────────────────────────────────
	"Bounced Files":    { category: "music", projectType: "Logic Pro",       risk: "medium", sentinels: ["*.logicx"], note: "Potrebbe essere il deliverable finale" },
	"Freeze Files":     { category: "music", projectType: "Logic Pro",       risk: "low",    sentinels: ["*.logicx"] },
	"Audio Files":      { category: "music", projectType: "Logic / Pro Tools", risk: "high", sentinels: ["*.logicx", "*.ptx"], note: "Può contenere il fonte audio originale" },
	Rendered:           { category: "music", projectType: "Ableton Live",    risk: "low",    sentinels: ["*.als"] },
	"Backup (Ableton)": { category: "music", projectType: "Ableton Live",   risk: "high",   sentinels: ["*.als"], note: "Backup automatici Ableton — verificare copia" },
	fl_studio_cache:    { category: "music", projectType: "FL Studio",       risk: "low",    sentinels: ["*.flp"] },
};

// vendor/ richiede disambiguazione runtime
const VENDOR_DISAMBIG: { sentinel: string; projectType: string }[] = [
	{ sentinel: "go.mod",        projectType: "Go" },
	{ sentinel: "Gemfile",       projectType: "Ruby" },
	{ sentinel: "composer.json", projectType: "PHP" },
];

const CLEANABLE_NAMES = new Set(Object.keys(CLEANABLE_RULES));
// Aggiungi "vendor" per la disambiguazione runtime
CLEANABLE_NAMES.add("vendor");

// --- Sensitive file detection ---
// Suffixes that indicate a template/example file (safe to commit, no real secrets)
const ENV_SAFE_SUFFIXES = new Set([
	".example", ".sample", ".template", ".dist", ".defaults", ".schema", ".doc", ".bak",
]);

function isEnvSensitive(name: string): boolean {
	// Must start with .env
	if (!name.startsWith(".env")) return false;
	// Bare ".env" is always sensitive
	if (name === ".env") return true;
	// .env.something — check if the suffix is a safe/template pattern
	const suffix = name.slice(4); // everything after ".env"
	if (ENV_SAFE_SUFFIXES.has(suffix.toLowerCase())) return false;
	return true;
}

// File names that are always considered sensitive (regardless of content)
const SENSITIVE_FILE_NAMES = new Set([
	"credentials.json", "service-account.json", "serviceAccountKey.json",
	".npmrc", ".pypirc",
]);

// Extensions for files that may contain secrets (checked by content)
const SENSITIVE_CHECK_EXTENSIONS = new Set([".pem", ".key", ".p12", ".pfx", ".jks", ".keystore"]);

// Patterns that indicate sensitive data inside files
const SENSITIVE_CONTENT_PATTERNS: RegExp[] = [
	/AKIA[0-9A-Z]{16}/,                          // AWS Access Key ID
	/aws_secret_access_key\s*[=:]/i,              // AWS Secret Key assignment
	/aws_access_key_id\s*[=:]/i,                  // AWS Access Key assignment
	/FIREBASE_API_KEY|firebase_api_key/i,          // Firebase API Key
	/GOOGLE_APPLICATION_CREDENTIALS/i,             // Google service account
	/STRIPE_SECRET_KEY|sk_live_/i,                 // Stripe secret key
	/SENDGRID_API_KEY/i,                           // SendGrid
	/TWILIO_AUTH_TOKEN/i,                          // Twilio
	/DATABASE_URL\s*=\s*postgres/i,                // Database connection strings
	/PRIVATE_KEY\s*[=:]/i,                         // Generic private key
	/-----BEGIN (RSA |EC |DSA )?PRIVATE KEY-----/, // PEM private key
	/ghp_[0-9a-zA-Z]{36}/,                        // GitHub personal access token
	/gho_[0-9a-zA-Z]{36}/,                        // GitHub OAuth token
	/sk-[a-zA-Z0-9]{20,}/,                        // OpenAI API key
];

function isSensitiveFileName(name: string): boolean {
	if (SENSITIVE_FILE_NAMES.has(name)) return true;
	if (isEnvSensitive(name)) return true;
	const ext = extname(name).toLowerCase();
	if (SENSITIVE_CHECK_EXTENSIONS.has(ext)) return true;
	return false;
}

function checkFileForSecrets(filePath: string, fileSize: number): boolean {
	try {
		if (fileSize > 256 * 1024 || fileSize === 0) return false;
		const buf = readFileSync(filePath, "utf-8");
		for (const pattern of SENSITIVE_CONTENT_PATTERNS) {
			if (pattern.test(buf)) return true;
		}
		return false;
	} catch {
		return false;
	}
}

function getDirSizeRecursive(dirPath: string): number {
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

// Controlla se un sentinel (possibilmente glob con *) esiste nella directory
function sentinelExists(dirPath: string, sentinel: string): boolean {
	if (sentinel.includes("*")) {
		// Punto 2: Bun.Glob per pattern matching nativo
		const glob = new Bun.Glob(sentinel);
		for (const _match of glob.scanSync({ cwd: dirPath, onlyFiles: true })) {
			return true;
		}
		return false;
	}
	// Supporta sentinel con path (es. ".storybook/main.js")
	return !!statSync(join(dirPath, sentinel), { throwIfNoEntry: false });
}

function detectCleanables(rootPath: string, maxDepth: number = 8): CleanableResult {
	const items: CleanableItem[] = [];

	function walk(dirPath: string, depth: number) {
		if (depth > maxDepth) return;
		if (scanCancelled) return;
		try {
			const entries = readdirSync(dirPath, { withFileTypes: true });
			for (const entry of entries) {
				if (scanCancelled) return;
				if (entry.name === ".Trash") continue;

				const fullPath = join(dirPath, entry.name);

				// Gestione file speciali (non-directory): .DS_Store, Thumbs.db, Desktop.ini
				if (!entry.isDirectory()) {
					// --- Sensitive file detection (.env, keys, credentials) ---
					if (isSensitiveFileName(entry.name)) {
						try {
							const stat = statSync(fullPath, { throwIfNoEntry: false });
							const fileSize = stat ? (stat.blocks ?? 0) * 512 : 0;
							if (fileSize > 0) {
								// For .env files, always flag. For key/pem files, check content too.
								const ext = extname(entry.name).toLowerCase();
								const alwaysSensitive = isEnvSensitive(entry.name) || SENSITIVE_FILE_NAMES.has(entry.name);
								const contentSensitive = SENSITIVE_CHECK_EXTENSIONS.has(ext) || checkFileForSecrets(fullPath, stat?.size ?? 0);
								if (alwaysSensitive || contentSensitive) {
									items.push({
										path: fullPath,
										projectPath: dirPath,
										projectType: "Secrets",
										folderName: entry.name,
										size: fileSize,
										risk: "high" as RiskLevel,
										category: "secrets" as Category,
										note: "sensitiveDataFound",
									});
								}
							}
						} catch {}
						continue;
					}

					if (CLEANABLE_NAMES.has(entry.name)) {
						const rule = CLEANABLE_RULES[entry.name];
						if (rule) {
							let confirmed = rule.sentinels.length === 0;
							if (!confirmed) {
								for (const sentinel of rule.sentinels) {
									if (sentinelExists(dirPath, sentinel)) { confirmed = true; break; }
								}
							}
							if (confirmed) {
								try {
									const stat = statSync(fullPath, { throwIfNoEntry: false });
									const fileSize = stat ? (stat.blocks ?? 0) * 512 : 0;
									if (fileSize > 0) {
										items.push({
											path: fullPath,
											projectPath: dirPath,
											projectType: rule.projectType,
											folderName: entry.name,
											size: fileSize,
											risk: rule.risk,
											category: rule.category,
											note: rule.note,
										});
									}
								} catch {}
							}
						}
					}
					continue;
				}

				// Disambiguazione vendor/
				if (entry.name === "vendor") {
					let vendorProjectType: string | null = null;
					for (const v of VENDOR_DISAMBIG) {
						if (statSync(join(dirPath, v.sentinel), { throwIfNoEntry: false })) {
							vendorProjectType = v.projectType;
							break;
						}
					}
					if (vendorProjectType) {
						const size = getDirSizeRecursive(fullPath);
						if (size > 0) {
							items.push({
								path: fullPath,
								projectPath: dirPath,
								projectType: vendorProjectType,
								folderName: entry.name,
								size,
								risk: "low" as RiskLevel,
								category: "dev" as Category,
							});
						}
						continue;
					}
				}

				if (CLEANABLE_NAMES.has(entry.name)) {
					const rule = CLEANABLE_RULES[entry.name]!;
					// Disambiguazione target/: identifica il tipo di progetto specifico
					let resolvedProjectType = rule.projectType;
					if (entry.name === "target" && rule.disambig) {
						if (statSync(join(dirPath, "Cargo.toml"), { throwIfNoEntry: false })) {
							resolvedProjectType = "Rust";
						} else if (statSync(join(dirPath, "pom.xml"), { throwIfNoEntry: false })) {
							resolvedProjectType = "Java/Maven";
						}
					}

					// Check sentinels in parent directory
					let confirmed = rule.sentinels.length === 0;
					if (!confirmed) {
						for (const sentinel of rule.sentinels) {
							if (sentinelExists(dirPath, sentinel)) {
								confirmed = true;
								break;
							}
						}
					}
					if (confirmed) {
						const size = getDirSizeRecursive(fullPath);
						if (size > 0) {
							items.push({
								path: fullPath,
								projectPath: dirPath,
								projectType: resolvedProjectType,
								folderName: entry.name,
								size,
								risk: rule.risk,
								category: rule.category,
								note: rule.note,
							});
						}
						// Don't recurse into cleanable folders
						continue;
					}
				}

				// Recurse into non-cleanable directories (skip hidden dirs except specific ones)
				if (!entry.name.startsWith(".") || CLEANABLE_NAMES.has(entry.name)) {
					walk(fullPath, depth + 1);
				}
			}
		} catch {}
	}

	walk(rootPath, 0);
	items.sort((a, b) => b.size - a.size);
	const totalSize = items.reduce((s, i) => s + i.size, 0);
	return { items, totalSize };
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

// --- Entry Info for preview panel ---
interface EntryInfo {
	path: string;
	name: string;
	size: number;
	isDir: boolean;
	modifiedAt: number;
	createdAt: number;
	// Directory-specific
	fileCount?: number;
	dirCount?: number;
	largestFile?: { name: string; size: number };
	newestFile?: { name: string; modifiedAt: number };
	typeDistribution?: { label: string; percentage: number; color: string }[];
	// File-specific
	extension?: string;
	previewType?: "text" | "image" | "none";
	textPreview?: string;
}

const TEXT_EXTENSIONS = new Set([
	".txt", ".md", ".json", ".js", ".ts", ".tsx", ".jsx", ".css", ".html", ".xml",
	".yml", ".yaml", ".toml", ".ini", ".cfg", ".conf", ".sh", ".bash", ".zsh",
	".py", ".rb", ".rs", ".go", ".java", ".c", ".cpp", ".h", ".hpp", ".swift",
	".kt", ".scala", ".lua", ".r", ".sql", ".graphql", ".env", ".gitignore",
	".dockerfile", ".makefile", ".cmake", ".gradle", ".properties", ".csv", ".tsv",
	".log", ".lock", ".editorconfig", ".prettierrc", ".eslintrc",
]);

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp", ".ico"]);

const TYPE_CATEGORIES: { label: string; extensions: Set<string>; color: string }[] = [
	{ label: "code", extensions: new Set([".js", ".ts", ".tsx", ".jsx", ".py", ".rb", ".rs", ".go", ".java", ".c", ".cpp", ".h", ".hpp", ".swift", ".kt", ".scala", ".lua", ".r", ".sh", ".bash", ".zsh"]), color: "#6c5ce7" },
	{ label: "images", extensions: new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp", ".ico", ".tiff"]), color: "#00b894" },
	{ label: "documents", extensions: new Set([".md", ".txt", ".pdf", ".doc", ".docx", ".rtf", ".csv", ".tsv"]), color: "#0984e3" },
	{ label: "config", extensions: new Set([".json", ".yml", ".yaml", ".toml", ".ini", ".cfg", ".conf", ".xml", ".env", ".lock"]), color: "#fdcb6e" },
	{ label: "styles", extensions: new Set([".css", ".scss", ".sass", ".less", ".styl"]), color: "#e84393" },
	{ label: "html", extensions: new Set([".html", ".htm", ".hbs", ".ejs", ".pug"]), color: "#e17055" },
];

async function getEntryInfoFromFS(entryPath: string): Promise<EntryInfo | null> {
	try {
		const resolved = expandPath(entryPath);
		const stat = statSync(resolved, { throwIfNoEntry: false });
		if (!stat) return null;

		const info: EntryInfo = {
			path: resolved,
			name: basename(resolved),
			size: stat.isDirectory() ? 0 : (stat.blocks ?? 0) * 512,
			isDir: stat.isDirectory(),
			modifiedAt: stat.mtimeMs,
			createdAt: stat.birthtimeMs,
		};

		if (stat.isDirectory()) {
			// Gather directory stats
			let fileCount = 0;
			let dirCount = 0;
			let largestFile: { name: string; size: number } | undefined;
			let newestFile: { name: string; modifiedAt: number } | undefined;
			const extCounts: Record<string, number> = {};
			let totalFiles = 0;
			let totalSize = 0;

			try {
				const items = readdirSync(resolved, { withFileTypes: true });
				for (const item of items) {
					if (item.name.startsWith(".")) continue;
					const fullPath = join(resolved, item.name);
					try {
						const itemStat = statSync(fullPath, { throwIfNoEntry: false });
						if (!itemStat) continue;
						if (item.isDirectory()) {
							dirCount++;
						} else if (item.isFile()) {
							fileCount++;
							const fSize = (itemStat.blocks ?? 0) * 512;
							totalSize += fSize;
							if (!largestFile || fSize > largestFile.size) {
								largestFile = { name: item.name, size: fSize };
							}
							if (!newestFile || itemStat.mtimeMs > newestFile.modifiedAt) {
								newestFile = { name: item.name, modifiedAt: itemStat.mtimeMs };
							}
							const ext = extname(item.name).toLowerCase();
							if (ext) {
								extCounts[ext] = (extCounts[ext] || 0) + 1;
								totalFiles++;
							}
						}
					} catch {}
				}
			} catch {}

			info.size = totalSize;
			info.fileCount = fileCount;
			info.dirCount = dirCount;
			info.largestFile = largestFile;
			info.newestFile = newestFile;

			// Build type distribution
			if (totalFiles > 0) {
				const catCounts: { label: string; count: number; color: string }[] = [];
				const matched = new Set<string>();
				for (const cat of TYPE_CATEGORIES) {
					let count = 0;
					for (const [ext, c] of Object.entries(extCounts)) {
						if (cat.extensions.has(ext)) {
							count += c;
							matched.add(ext);
						}
					}
					if (count > 0) catCounts.push({ label: cat.label, count, color: cat.color });
				}
				// "Other" for unmatched
				let otherCount = 0;
				for (const [ext, c] of Object.entries(extCounts)) {
					if (!matched.has(ext)) otherCount += c;
				}
				if (otherCount > 0) catCounts.push({ label: "other", count: otherCount, color: "#dfe6e9" });

				catCounts.sort((a, b) => b.count - a.count);
				info.typeDistribution = catCounts.map((c) => ({
					label: c.label,
					percentage: Math.round((c.count / totalFiles) * 100),
					color: c.color,
				}));
			}
		} else {
			// File info
			const ext = extname(resolved).toLowerCase();
			info.extension = ext || undefined;

			if (IMAGE_EXTENSIONS.has(ext)) {
				info.previewType = "image";
			} else if (TEXT_EXTENSIONS.has(ext) || basename(resolved).toLowerCase() === "makefile" || basename(resolved).toLowerCase() === "dockerfile") {
				info.previewType = "text";
				try {
					// Punto 5: Bun.file() per la text preview
					const file = Bun.file(resolved);
					const buf = new Uint8Array(await file.slice(0, 5120).arrayBuffer());
					info.textPreview = new TextDecoder().decode(buf);
					if (file.size > 5120) info.textPreview += "\n…";
				} catch {}
			} else {
				info.previewType = "none";
			}
		}

		return info;
	} catch {
		return null;
	}
}

// --- Window & RPC ---
const display = Screen.getPrimaryDisplay();
const workArea = display.workArea;

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
			cancelScan: async () => {
				console.log("[scan] Cancel requested");
				scanCancelled = true;
				return { success: true };
			},
			deleteCacheEntry: async ({ rootPath }) => {
				const store = await loadCacheStore();
				store.entries = store.entries.filter((e) => e.rootPath !== rootPath);
				saveCacheStore(store);
				return { success: true };
			},
			scanDirectory: async ({ dirPath }) => {
				const targetPath = expandPath(dirPath || "~");
				console.log(`[scan] === REQUEST RECEIVED === dirPath="${dirPath}" targetPath="${targetPath}"`);

				if (!statSync(targetPath, { throwIfNoEntry: false })?.isDirectory()) {
					return { success: false, error: "Directory not found" };
				}

				scanCancelled = false;
				scanStats = { dirs: 0, files: 0, currentDir: targetPath };

				let lastProgressTime = 0;
				const sendProgress = async () => {
					const now = Date.now();
					if (now - lastProgressTime > 200) {
						lastProgressTime = now;
						rpc.send.scanProgress({
							currentDir: scanStats.currentDir,
						});
						await Bun.sleep(1);
					}
				};

				const settings = await loadSettings();
				console.log(`[scan] Starting scanDirectoryAsync (maxDepth=${settings.maxDepth})...`);
				const startNs = Bun.nanoseconds();
				try {
					const tree = await scanDirectoryAsync(targetPath, 0, settings.maxDepth, sendProgress);
					const elapsedMs = (Bun.nanoseconds() - startNs) / 1_000_000;
					console.log(`[scan] Scan complete in ${elapsedMs.toFixed(2)}ms — dirs=${scanStats.dirs} files=${scanStats.files} treeSize=${tree.size}`);
					const entry: CacheEntry = { timestamp: Date.now(), rootPath: targetPath, tree };
					// New scan: don't carry over old cleanables — they'll be re-detected
					const store = await loadCacheStore();
					saveCacheStore(await upsertCacheEntry(store, entry));
					console.log(`[scan] === RETURNING RESPONSE ===`);
					return { success: true, rootPath: targetPath };
				} catch (e: any) {
					if (e.message === "SCAN_CANCELLED") {
						const elapsedMs = (Bun.nanoseconds() - startNs) / 1_000_000;
						console.log(`[scan] Scan cancelled by user after ${elapsedMs.toFixed(2)}ms`);
						return { success: false, error: "SCAN_CANCELLED" };
					}
					console.error(`[scan] ERROR:`, e);
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
				// No cache found — return empty instead of scanning
				return { children: [] };
			},
			validatePath: async ({ dirPath }) => {
				try {
					const resolved = expandPath(dirPath || "");
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
					const isExactDir = statSync(expanded, { throwIfNoEntry: false })?.isDirectory();

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

					if (!statSync(dirToList, { throwIfNoEntry: false })?.isDirectory()) return { suggestions: [] };

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
					if (!statSync(resolved, { throwIfNoEntry: false })) {
						return { success: false, error: "Path does not exist" };
					}

					const settings = await loadSettings();
					if (settings.deleteMode === "trash") {
						// Punto 1: Bun.$ Shell API per il Trash macOS
						try {
							await $`osascript -e ${"tell application \"Finder\" to delete POSIX file \"" + resolved + "\""}`.quiet();
						} catch {
							// Fallback to permanent delete
							rmSync(resolved, { recursive: true, force: true });
						}
					} else {
						rmSync(resolved, { recursive: true, force: true });
					}

					const store = await loadCacheStore();
					for (const cacheEntry of store.entries) {
						if (removeDirFromCacheEntry(cacheEntry, resolved)) {
							saveCacheStore(store);
							break;
						}
					}
					return { success: true, rootPath: store.entries[0]?.rootPath };
				} catch (e: any) {
					return { success: false, error: e.message };
				}
			},
			getSettings: async () => {
				return await loadSettings();
			},
			saveSettings: async ({ maxCacheEntries, deleteMode, maxDepth }) => {
				const settings: AppSettings = {
					maxCacheEntries: Math.max(1, Math.min(50, maxCacheEntries)),
					deleteMode: deleteMode === "permanent" ? "permanent" : "trash",
					maxDepth: Math.max(1, Math.min(30, maxDepth)),
				};
				await saveSettings(settings);
				// Trim cache if needed
				const store = await loadCacheStore();
				if (store.entries.length > settings.maxCacheEntries) {
					store.entries = store.entries.slice(0, settings.maxCacheEntries);
					saveCacheStore(store);
				}
				return { success: true };
			},
			detectCleanables: async ({ rootPath }) => {
				const resolved = expandPath(rootPath);
				if (!statSync(resolved, { throwIfNoEntry: false })?.isDirectory()) return { items: [], totalSize: 0 };
				console.log(`[cleanables] Scanning ${resolved}...`);
				const startNs = Bun.nanoseconds();
				const result = detectCleanables(resolved);
				const elapsedMs = (Bun.nanoseconds() - startNs) / 1_000_000;
				console.log(`[cleanables] Found ${result.items.length} items (${result.totalSize} bytes) in ${elapsedMs.toFixed(2)}ms`);
				return result;
			},
			getCachedCleanables: async ({ rootPath }) => {
				const resolved = expandPath(rootPath);
				const store = await loadCacheStore();
				const entry = findCacheEntry(store, resolved);
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
				if (entry) {
					entry.cleanables = cleanables;
					saveCacheStore(store);
					console.log(`[cleanables] Saved to cache for ${resolved} (${cleanables.items.length} items)`);
					return { success: true };
				}
				return { success: false };
			},
			batchDelete: async ({ paths }) => {
				const settings = await loadSettings();
				const store = await loadCacheStore();
				let deletedCount = 0;
				let deletedSize = 0;
				const errors: string[] = [];
				let cacheModified = false;

				for (const p of paths) {
					try {
						const resolved = expandPath(p);
						if (!statSync(resolved, { throwIfNoEntry: false })) {
							errors.push(`${p}: not found`);
							continue;
						}
						// Get size before deleting
						const size = getDirSizeRecursive(resolved);

						if (settings.deleteMode === "trash") {
							try {
								await $`osascript -e ${"tell application \"Finder\" to delete POSIX file \"" + resolved + "\""}`.quiet();
							} catch {
								rmSync(resolved, { recursive: true, force: true });
							}
						} else {
							rmSync(resolved, { recursive: true, force: true });
						}

						deletedCount++;
						deletedSize += size;

						// Update cache
						for (const cacheEntry of store.entries) {
							if (removeDirFromCacheEntry(cacheEntry, resolved)) {
								cacheModified = true;
								break;
							}
						}
					} catch (e: any) {
						errors.push(`${p}: ${e.message}`);
					}
				}

				if (cacheModified) saveCacheStore(store);
				return { success: errors.length === 0, deletedCount, deletedSize, errors };
			},
			getEntryInfo: async ({ entryPath }) => {
				const info = getEntryInfoFromFS(entryPath);
				if (!info) return { error: "Cannot read entry info" } as any;
				return info;
			},
			getStats: async ({ days }) => {
				const stats = await loadStats();
				const cutoff = new Date();
				cutoff.setDate(cutoff.getDate() - days);
				const cutoffStr = cutoff.toISOString().slice(0, 10);
				const filtered = stats.entries.filter((e) => e.date >= cutoffStr);
				const totalFreed = filtered.reduce((s, e) => s + e.freedBytes, 0);
				const totalDeleted = filtered.reduce((s, e) => s + e.deleteCount, 0);
				return { entries: filtered, totalFreed, totalDeleted };
			},
			recordDeletion: async ({ freedBytes, deleteCount }) => {
				await recordDeletion(freedBytes, deleteCount);
				return { success: true };
			},
			revealInFinder: async ({ filePath }) => {
				try {
					const resolved = expandPath(filePath);
					const stat = statSync(resolved, { throwIfNoEntry: false });
					if (!stat) return { success: false };
					// If it's a file, reveal it (selects it in Finder). If directory, open it.
					if (stat.isDirectory()) {
						await $`open ${resolved}`.quiet();
					} else {
						await $`open -R ${resolved}`.quiet();
					}
					return { success: true };
				} catch {
					return { success: false };
				}
			},
			checkEnvsecAvailable: async () => {
				try {
					const { EnvsecClient } = await import("@envsec/sdk");
					const client = await EnvsecClient.create({ context: "__envsec_check__" });
					await client.close();
					return { available: true };
				} catch {
					return { available: false };
				}
			},
			importEnvToEnvsec: async ({ filePath, context }) => {
				try {
					const resolved = expandPath(filePath);
					const content = readFileSync(resolved, "utf-8");
					// Parse .env file
					const entries: [string, string][] = [];
					for (const line of content.split("\n")) {
						const trimmed = line.trim();
						if (!trimmed || trimmed.startsWith("#")) continue;
						const eqIdx = trimmed.indexOf("=");
						if (eqIdx < 1) continue;
						const key = trimmed.slice(0, eqIdx).trim();
						let value = trimmed.slice(eqIdx + 1).trim();
						// Strip surrounding quotes
						if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
							value = value.slice(1, -1);
						}
						if (key && value) entries.push([key, value]);
					}
					if (entries.length === 0) {
						return { success: false, imported: 0, error: "No valid entries found in file" };
					}
					const { EnvsecClient } = await import("@envsec/sdk");
					const client = await EnvsecClient.create({ context });
					let imported = 0;
					for (const [key, value] of entries) {
						await client.set(key, value);
						imported++;
					}
					await client.close();
					// Delete the .env file after successful import
					rmSync(resolved, { force: true });
					// Remove from cache tree
					const store = await loadCacheStore();
					let cacheModified = false;
					for (const cacheEntry of store.entries) {
						if (removeDirFromCacheEntry(cacheEntry, resolved)) {
							cacheModified = true;
							break;
						}
					}
					if (cacheModified) saveCacheStore(store);
					console.log(`[envsec] Imported ${imported} secrets from ${resolved} to context "${context}"`);
					return { success: true, imported };
				} catch (e: any) {
					console.error("[envsec] Import error:", e);
					return { success: false, imported: 0, error: e.message };
				}
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
		},
		messages: {},
	},
});

const mainWin = new BrowserWindow({
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
	scanCancelled = true;
	process.exit(0);
});
process.on("SIGINT", () => {
	scanCancelled = true;
	process.exit(0);
});
