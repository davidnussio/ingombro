import { basename, extname, join } from "path";
import { Context, Effect, FileSystem, Layer, Option } from "effect";
import { PathNotFound } from "./errors";
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

const PREVIEW_BYTES = 5120;

type Info = FileSystem.File.Info;
const diskUsage = (info: Info) => Number(Option.getOrElse(info.blocks, () => 0n)) * 512;
const millis = (date: Option.Option<Date>) => Option.match(date, { onNone: () => 0, onSome: (d) => d.getTime() });

function typeDistribution(extCounts: Map<string, number>, totalFiles: number): EntryInfo["typeDistribution"] {
	const catCounts: { label: string; count: number; color: string }[] = [];
	const matched = new Set<string>();
	for (const cat of TYPE_CATEGORIES) {
		let count = 0;
		for (const [ext, c] of extCounts) {
			if (cat.extensions.has(ext)) {
				count += c;
				matched.add(ext);
			}
		}
		if (count > 0) catCounts.push({ label: cat.label, count, color: cat.color });
	}
	// "Other" for unmatched
	let otherCount = 0;
	for (const [ext, c] of extCounts) if (!matched.has(ext)) otherCount += c;
	if (otherCount > 0) catCounts.push({ label: "other", count: otherCount, color: "#dfe6e9" });

	catCounts.sort((a, b) => b.count - a.count);
	return catCounts.map((c) => ({ label: c.label, percentage: Math.round((c.count / totalFiles) * 100), color: c.color }));
}

/** Details for the preview / info panel: directory summary or file preview. */
export class EntryInfoReader extends Context.Service<
	EntryInfoReader,
	{
		get(entryPath: string): Effect.Effect<EntryInfo, PathNotFound>;
	}
>()("ingombro/core/EntryInfoReader") {
	static readonly layer = Layer.effect(
		EntryInfoReader,
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;

			const directoryInfo = Effect.fnUntraced(function* (resolved: string) {
				const names = yield* fs.readDirectory(resolved).pipe(Effect.orElseSucceed((): string[] => []));
				const visible = names.filter((name) => !name.startsWith("."));
				const stats = yield* Effect.forEach(
					visible,
					(name) => fs.stat(join(resolved, name)).pipe(Effect.option, Effect.map((stat) => ({ name, stat }))),
					{ concurrency: 32 },
				);

				let fileCount = 0;
				let dirCount = 0;
				let totalSize = 0;
				let totalFiles = 0;
				let largestFile: { name: string; size: number } | undefined;
				let newestFile: { name: string; modifiedAt: number } | undefined;
				const extCounts = new Map<string, number>();
				for (const { name, stat } of stats) {
					if (Option.isNone(stat)) continue;
					if (stat.value.type === "Directory") {
						dirCount++;
					} else if (stat.value.type === "File") {
						fileCount++;
						const fSize = diskUsage(stat.value);
						const mtime = millis(stat.value.mtime);
						totalSize += fSize;
						if (!largestFile || fSize > largestFile.size) largestFile = { name, size: fSize };
						if (!newestFile || mtime > newestFile.modifiedAt) newestFile = { name, modifiedAt: mtime };
						const ext = extname(name).toLowerCase();
						if (ext) {
							extCounts.set(ext, (extCounts.get(ext) ?? 0) + 1);
							totalFiles++;
						}
					}
				}
				return {
					size: totalSize,
					fileCount,
					dirCount,
					largestFile,
					newestFile,
					typeDistribution: totalFiles > 0 ? typeDistribution(extCounts, totalFiles) : undefined,
				};
			});

			const textPreview = (resolved: string, size: number) =>
				Effect.scoped(
					Effect.gen(function* () {
						const file = yield* fs.open(resolved);
						const bytes = yield* file.readAlloc(PREVIEW_BYTES);
						const text = Option.match(bytes, { onNone: () => "", onSome: (b) => new TextDecoder().decode(b) });
						return size > PREVIEW_BYTES ? text + "\n…" : text;
					}),
				).pipe(Effect.option, Effect.map(Option.getOrUndefined));

			const get = Effect.fn("EntryInfoReader.get")(function* (entryPath: string) {
				const resolved = expandPath(entryPath);
				const stat = yield* fs.stat(resolved).pipe(Effect.mapError(() => new PathNotFound({ path: resolved })));
				const isDir = stat.type === "Directory";
				const base: EntryInfo = {
					path: resolved,
					name: basename(resolved),
					size: isDir ? 0 : diskUsage(stat),
					isDir,
					modifiedAt: millis(stat.mtime),
					createdAt: millis(stat.birthtime),
				};

				if (isDir) return { ...base, ...(yield* directoryInfo(resolved)) };

				const ext = extname(resolved).toLowerCase();
				const lowerName = basename(resolved).toLowerCase();
				if (IMAGE_EXTENSIONS.has(ext)) return { ...base, extension: ext || undefined, previewType: "image" as const };
				if (TEXT_EXTENSIONS.has(ext) || lowerName === "makefile" || lowerName === "dockerfile") {
					return {
						...base,
						extension: ext || undefined,
						previewType: "text" as const,
						textPreview: yield* textPreview(resolved, Number(stat.size)),
					};
				}
				return { ...base, extension: ext || undefined, previewType: "none" as const };
			});

			return EntryInfoReader.of({ get });
		}),
	);
}
