export interface Translations {
	// Welcome screen
	welcomeDesc: string;
	scanLabel: string;
	scanButton: string;
	dirNotFound: string;

	// Scanning
	scanningText: string;
	cancelScan: string;
	scanCancelled: string;

	// Results
	rescanButton: string;
	backTitle: string;
	navigation: string;

	// Clean banner
	cleanAnalyzing: string;
	cleanRecoverable: (size: string, count: number) => string;
	cleanDetails: string;

	// Clean modal
	smartCleanTitle: string;
	cleanModalDesc: string;
	selectAll: string;
	cleanSelected: (count: number) => string;
	cleanSelectedWithSize: (size: string) => string;
	cleaningInProgress: string;
	cancel: string;

	// Delete modal
	deleteConfirmTitle: string;
	deleteConfirmMessage: (name: string, size: string) => string;
	deleteConfirmMessageTrash: (name: string, size: string) => string;
	deleteButton: string;

	// Toast
	freedJust: string;
	freedSessionTotal: string;

	// Info panel
	infoTitle: string;
	loading: string;
	loadError: string;
	connectionError: string;
	errorTitle: string;
	closeEsc: string;

	// Info panel content
	details: string;
	size: string;
	files: string;
	folders: string;
	lastModified: string;
	created: string;
	largestFile: string;
	newestModified: string;
	typeDistribution: string;
	preview: string;
	path: string;

	// Settings
	settingsTitle: string;
	maxCache: string;
	scanDepth: string;
	deleteMode: string;
	deleteModeTrash: string;
	deleteModePermanent: string;
	language: string;

	// Cache list
	openCache: string;
	scanCache: string;
	removeCache: string;

	// Errors
	errorPrefix: string;
	scanFailed: string;
	deleteError: string;
	unknownError: string;
	notFound: string;
	cannotReadInfo: string;

	// Clean filters
	filterAll: string;

	// Sensitive data
	sensitiveDataFound: string;
	revealInFinder: string;
	importToEnvsec: string;
	envsecImportSuccess: (count: number, context: string) => string;
	envsecImportError: string;
	envsecNotAvailable: string;
	envsecContextPrompt: string;
	envsecImportTitle: string;
	envsecConfirmImport: string;
	envsecImporting: string;

	// Type categories
	typeCode: string;
	typeImages: string;
	typeDocuments: string;
	typeConfig: string;
	typeStyles: string;
	typeHTML: string;
	typeOther: string;

	// Stats widget
	statsTitle: string;
	statsTotal: string;
	statsNoData: string;
}
