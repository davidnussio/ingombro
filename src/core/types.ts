// Shared types used by the desktop app (Electrobun) and the terminal UI.

export interface DirEntry {
	path: string;
	name: string;
	size: number;
	children?: DirEntry[];
	isDir: boolean;
}

export interface CacheEntry {
	timestamp: number;
	rootPath: string;
	tree: DirEntry;
	cleanables?: CleanableResult;
}

export interface CacheData {
	entries: CacheEntry[];
}

export interface AppSettings {
	maxCacheEntries: number;
	deleteMode: "trash" | "permanent";
	maxDepth: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
	maxCacheEntries: 10,
	deleteMode: "trash",
	maxDepth: 10,
};

export type RiskLevel = "low" | "medium" | "high";
export type Category = "dev" | "ml" | "office" | "design" | "video" | "music" | "secrets";

export interface CleanableItem {
	path: string;
	projectPath: string;
	projectType: string;
	folderName: string;
	size: number;
	risk: RiskLevel;
	category: Category;
	note?: string;
}

export interface CleanableResult {
	items: CleanableItem[];
	totalSize: number;
}

export interface EntryInfo {
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

export interface StatsEntry {
	date: string; // YYYY-MM-DD
	freedBytes: number;
	deleteCount: number;
}

export interface StatsData {
	entries: StatsEntry[];
}

export interface ScanProgress {
	dirs: number;
	files: number;
	currentDir: string;
}

/** Cooperative cancellation shared by scanner and Smart Clean detection. */
export interface CancelToken {
	cancelled: boolean;
}

export class ScanCancelledError extends Error {
	constructor() {
		super("SCAN_CANCELLED");
		this.name = "ScanCancelledError";
	}
}
