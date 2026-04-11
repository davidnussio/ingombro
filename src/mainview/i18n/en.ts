import type { Translations } from "./types";

const en: Translations = {
	welcomeDesc: "Analyze disk space and clean up unnecessary directories.",
	scanLabel: "Directory to scan",
	scanButton: "Scan",
	dirNotFound: "Directory does not exist",

	scanningText: "Scanning...",
	cancelScan: "Cancel",
	scanCancelled: "Scan cancelled",

	rescanButton: "Rescan",
	backTitle: "Go back",
	navigation: "Navigation",

	cleanAnalyzing: "Analyzing directories…",
	cleanRecoverable: (size, count) => `${size} recoverable from ${count} project folder${count === 1 ? "" : "s"}`,
	cleanDetails: "View details",

	smartCleanTitle: "✨ Smart Clean",
	cleanModalDesc: "Removable project folders to free up space.",
	selectAll: "Select all",
	cleanSelected: (count) => `${count} selected`,
	cleanSelectedWithSize: (size) => `Clean selected (${size})`,
	cleaningInProgress: "Cleaning…",
	cancel: "Cancel",

	deleteConfirmTitle: "Confirm deletion",
	deleteConfirmMessage: (name, size) => `Are you sure you want to delete "${name}" (${size})? This action is irreversible.`,
	deleteConfirmMessageTrash: (name, size) => `Are you sure you want to delete "${name}" (${size})? The item will be moved to Trash.`,
	deleteButton: "Delete",

	freedJust: "Freed",
	freedSessionTotal: "Session total:",

	infoTitle: "Info",
	loading: "Loading…",
	loadError: "Unable to load information",
	connectionError: "Connection error",
	errorTitle: "Error",
	closeEsc: "Close (Esc)",

	details: "Details",
	size: "Size",
	files: "Files",
	folders: "Folders",
	lastModified: "Last modified",
	created: "Created",
	largestFile: "Largest file",
	newestModified: "Most recently modified",
	typeDistribution: "Type distribution",
	preview: "Preview",
	path: "Path",

	settingsTitle: "Settings",
	maxCache: "Max cache entries",
	scanDepth: "Scan depth",
	deleteMode: "Deletion",
	deleteModeTrash: "Trash",
	deleteModePermanent: "Permanent",
	language: "Language",

	openCache: "Open cache",
	scanCache: "Scan",
	removeCache: "Remove",

	errorPrefix: "Error:",
	scanFailed: "scan failed",
	deleteError: "Error during deletion:",
	unknownError: "unknown",
	notFound: "not found",
	cannotReadInfo: "Unable to read information",

	filterAll: "All",

	typeCode: "Code",
	typeImages: "Images",
	typeDocuments: "Documents",
	typeConfig: "Config",
	typeStyles: "Styles",
	typeHTML: "HTML",
	typeOther: "Other",

	statsTitle: "Space freed",
	statsTotal: "Total",
	statsNoData: "No cleanup recorded yet",
};

export default en;
