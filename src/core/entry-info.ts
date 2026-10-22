import { readdirSync, statSync } from "fs";
import { basename, extname, join } from "path";
import { expandPath } from "./paths";
import type { EntryInfo } from "./types";

// --- Entry Info for preview panel ---
export const TEXT_EXTENSIONS = new Set([
	".txt", ".md", ".json", ".js", ".ts", ".tsx", ".jsx", ".css", ".html", ".xml",
	".yml", ".yaml", ".toml", ".ini", ".cfg", ".conf", ".sh", ".bash", ".zsh",
	".py", ".rb", ".rs", ".go", ".java", ".c", ".cpp", ".h", ".hpp", ".swift",
	".kt", ".scala", ".lua", ".r", ".sql", ".graphql", ".env", ".gitignore",
	".dockerfile", ".makefile", ".cmake", ".gradle", ".properties", ".csv", ".tsv",
	".log", ".lock", ".editorconfig", ".prettierrc", ".eslintrc",
]);

export const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp", ".ico"]);

const TYPE_CATEGORIES: { label: string; extensions: Set<string>; color: string }[] = [
	{ label: "code", extensions: new Set([".js", ".ts", ".tsx", ".jsx", ".py", ".rb", ".rs", ".go", ".java", ".c", ".cpp", ".h", ".hpp", ".swift", ".kt", ".scala", ".lua", ".r", ".sh", ".bash", ".zsh"]), color: "#6c5ce7" },
	{ label: "images", extensions: new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp", ".ico", ".tiff"]), color: "#00b894" },
	{ label: "documents", extensions: new Set([".md", ".txt", ".pdf", ".doc", ".docx", ".rtf", ".csv", ".tsv"]), color: "#0984e3" },
	{ label: "config", extensions: new Set([".json", ".yml", ".yaml", ".toml", ".ini", ".cfg", ".conf", ".xml", ".env", ".lock"]), color: "#fdcb6e" },
	{ label: "styles", extensions: new Set([".css", ".scss", ".sass", ".less", ".styl"]), color: "#e84393" },
	{ label: "html", extensions: new Set([".html", ".htm", ".hbs", ".ejs", ".pug"]), color: "#e17055" },
];

export async function getEntryInfo(entryPath: string): Promise<EntryInfo | null> {
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
