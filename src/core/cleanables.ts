import { readdirSync, readFileSync, statSync } from "fs";
import { extname, join } from "path";
import { getDirSizeRecursive } from "./scanner";
import type { CancelToken, Category, CleanableItem, CleanableResult, RiskLevel } from "./types";

// --- Smart Clean: cleanable folder detection ---

export interface CleanableRule {
	projectType: string;
	category: Category;
	sentinels: string[];
	risk: RiskLevel;
	note?: string;
	disambig?: string;
}

export const CLEANABLE_RULES: Record<string, CleanableRule> = {
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

export function isEnvSensitive(name: string): boolean {
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

export function isSensitiveFileName(name: string): boolean {
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

export interface DetectOptions {
	maxDepth?: number;
	cancel?: CancelToken;
	/** Called for every directory walked (not throttled). */
	onDir?: (dirPath: string) => void;
}

export async function detectCleanables(rootPath: string, opts: DetectOptions = {}): Promise<CleanableResult> {
	const maxDepth = opts.maxDepth ?? 8;
	const cancel = opts.cancel ?? { cancelled: false };
	const items: CleanableItem[] = [];

	let lastYield = Date.now();
	async function walk(dirPath: string, depth: number): Promise<void> {
		if (depth > maxDepth) return;
		if (cancel.cancelled) return;
		opts.onDir?.(dirPath);
		// Yield to the event loop now and then so UIs can repaint / cancel
		if (Date.now() - lastYield > 50) {
			lastYield = Date.now();
			await Bun.sleep(0);
		}
		try {
			const entries = readdirSync(dirPath, { withFileTypes: true });
			for (const entry of entries) {
				if (cancel.cancelled) return;
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
					await walk(fullPath, depth + 1);
				}
			}
		} catch {}
	}

	await walk(rootPath, 0);
	items.sort((a, b) => b.size - a.size);
	const totalSize = items.reduce((s, i) => s + i.size, 0);
	return { items, totalSize };
}
