// Shared domain model used by the desktop app (Electrobun) and the terminal UI.
// Every shape is a Schema so persisted JSON (cache, settings, stats) is decoded, not trusted.
import { Effect, Schema } from "effect";

export interface DirEntry {
	readonly path: string;
	readonly name: string;
	readonly size: number;
	readonly isDir: boolean;
	readonly children?: ReadonlyArray<DirEntry> | undefined;
}

export const DirEntry: Schema.Codec<DirEntry> = Schema.Struct({
	path: Schema.String,
	name: Schema.String,
	size: Schema.Number,
	isDir: Schema.Boolean,
	children: Schema.optional(Schema.Array(Schema.suspend((): Schema.Codec<DirEntry> => DirEntry))),
});

export const RiskLevel = Schema.Literals(["low", "medium", "high"]);
export type RiskLevel = typeof RiskLevel.Type;

export const Category = Schema.Literals(["dev", "ml", "office", "design", "video", "music", "secrets"]);
export type Category = typeof Category.Type;

export const CleanableItem = Schema.Struct({
	path: Schema.String,
	projectPath: Schema.String,
	projectType: Schema.String,
	folderName: Schema.String,
	size: Schema.Number,
	risk: RiskLevel,
	category: Category,
	note: Schema.optional(Schema.String),
});
export interface CleanableItem extends Schema.Schema.Type<typeof CleanableItem> {}

export const CleanableResult = Schema.Struct({
	items: Schema.Array(CleanableItem),
	totalSize: Schema.Number,
});
export interface CleanableResult extends Schema.Schema.Type<typeof CleanableResult> {}

export const CacheEntry = Schema.Struct({
	timestamp: Schema.Number,
	rootPath: Schema.String,
	tree: DirEntry,
	cleanables: Schema.optional(CleanableResult),
});
export interface CacheEntry extends Schema.Schema.Type<typeof CacheEntry> {}

export const CacheData = Schema.Struct({
	entries: Schema.Array(CacheEntry),
});
export interface CacheData extends Schema.Schema.Type<typeof CacheData> {}

/** Pre-1.0 cache files stored a single scan at the top level. */
export const LegacyCacheData = Schema.Struct({
	timestamp: Schema.Number,
	rootPath: Schema.String,
	tree: DirEntry,
});

export const DeleteMode = Schema.Literals(["trash", "permanent"]);
export type DeleteMode = typeof DeleteMode.Type;

export const AppSettings = Schema.Struct({
	maxCacheEntries: Schema.Number,
	deleteMode: DeleteMode,
	maxDepth: Schema.Number,
});
export interface AppSettings extends Schema.Schema.Type<typeof AppSettings> {}

export const DEFAULT_SETTINGS: AppSettings = {
	maxCacheEntries: 10,
	deleteMode: "trash",
	maxDepth: 10,
};

/** settings.json as stored on disk: missing keys fall back to the defaults. */
export const SettingsFile = Schema.Struct({
	maxCacheEntries: AppSettings.fields.maxCacheEntries.pipe(
		Schema.withDecodingDefaultKey(Effect.succeed(DEFAULT_SETTINGS.maxCacheEntries)),
	),
	deleteMode: DeleteMode.pipe(Schema.withDecodingDefaultKey(Effect.succeed(DEFAULT_SETTINGS.deleteMode))),
	maxDepth: AppSettings.fields.maxDepth.pipe(Schema.withDecodingDefaultKey(Effect.succeed(DEFAULT_SETTINGS.maxDepth))),
});

export const EntryInfo = Schema.Struct({
	path: Schema.String,
	name: Schema.String,
	size: Schema.Number,
	isDir: Schema.Boolean,
	modifiedAt: Schema.Number,
	createdAt: Schema.Number,
	// Directory-specific
	fileCount: Schema.optional(Schema.Number),
	dirCount: Schema.optional(Schema.Number),
	largestFile: Schema.optional(Schema.Struct({ name: Schema.String, size: Schema.Number })),
	newestFile: Schema.optional(Schema.Struct({ name: Schema.String, modifiedAt: Schema.Number })),
	typeDistribution: Schema.optional(
		Schema.Array(Schema.Struct({ label: Schema.String, percentage: Schema.Number, color: Schema.String })),
	),
	// File-specific
	extension: Schema.optional(Schema.String),
	previewType: Schema.optional(Schema.Literals(["text", "image", "none"])),
	textPreview: Schema.optional(Schema.String),
});
export interface EntryInfo extends Schema.Schema.Type<typeof EntryInfo> {}

export const StatsEntry = Schema.Struct({
	date: Schema.String, // YYYY-MM-DD
	freedBytes: Schema.Number,
	deleteCount: Schema.Number,
});
export interface StatsEntry extends Schema.Schema.Type<typeof StatsEntry> {}

export const StatsData = Schema.Struct({
	entries: Schema.Array(StatsEntry),
});
export interface StatsData extends Schema.Schema.Type<typeof StatsData> {}

export interface StatsSummary {
	readonly entries: ReadonlyArray<StatsEntry>;
	readonly totalFreed: number;
	readonly totalDeleted: number;
}

export interface ScanProgress {
	readonly dirs: number;
	readonly files: number;
	readonly currentDir: string;
}

export interface CacheListItem {
	readonly rootPath: string;
	readonly timestamp: number;
	readonly size: number;
}
