import type { Translations } from "./types";

const de: Translations = {
	welcomeDesc: "Speicherplatz analysieren und unnötige Verzeichnisse bereinigen.",
	scanLabel: "Zu scannendes Verzeichnis",
	scanButton: "Scannen",
	dirNotFound: "Verzeichnis existiert nicht",

	scanningText: "Wird gescannt...",
	cancelScan: "Abbrechen",
	scanCancelled: "Scan abgebrochen",

	rescanButton: "Erneut scannen",
	backTitle: "Zurück",
	navigation: "Navigation",

	cleanAnalyzing: "Verzeichnisse werden analysiert…",
	cleanRecoverable: (size, count) => `${size} wiederherstellbar aus ${count} Projektordner${count === 1 ? "" : "n"}`,
	cleanDetails: "Details anzeigen",

	smartCleanTitle: "✨ Smart Clean",
	cleanModalDesc: "Löschbare Projektordner zur Freigabe von Speicherplatz.",
	selectAll: "Alle auswählen",
	cleanSelected: (count) => `${count} ausgewählt`,
	cleanSelectedWithSize: (size) => `Auswahl bereinigen (${size})`,
	cleaningInProgress: "Wird bereinigt…",
	cancel: "Abbrechen",

	deleteConfirmTitle: "Löschen bestätigen",
	deleteConfirmMessage: (name, size) => `Sind Sie sicher, dass Sie „${name}" (${size}) löschen möchten? Diese Aktion ist unwiderruflich.`,
	deleteConfirmMessageTrash: (name, size) => `Sind Sie sicher, dass Sie „${name}" (${size}) löschen möchten? Das Element wird in den Papierkorb verschoben.`,
	deleteButton: "Löschen",

	freedJust: "Freigegeben",
	freedSessionTotal: "Sitzung gesamt:",

	infoTitle: "Info",
	loading: "Wird geladen…",
	loadError: "Informationen konnten nicht geladen werden",
	connectionError: "Verbindungsfehler",
	errorTitle: "Fehler",
	closeEsc: "Schließen (Esc)",

	details: "Details",
	size: "Größe",
	files: "Dateien",
	folders: "Ordner",
	lastModified: "Letzte Änderung",
	created: "Erstellt",
	largestFile: "Größte Datei",
	newestModified: "Zuletzt geändert",
	typeDistribution: "Typverteilung",
	preview: "Vorschau",
	path: "Pfad",

	settingsTitle: "Einstellungen",
	maxCache: "Max. Cache-Einträge",
	scanDepth: "Scan-Tiefe",
	deleteMode: "Löschmodus",
	deleteModeTrash: "Papierkorb",
	deleteModePermanent: "Endgültig",
	language: "Sprache",

	openCache: "Cache öffnen",
	scanCache: "Scannen",
	removeCache: "Entfernen",

	errorPrefix: "Fehler:",
	scanFailed: "Scan fehlgeschlagen",
	deleteError: "Fehler beim Löschen:",
	unknownError: "unbekannt",
	notFound: "nicht gefunden",
	cannotReadInfo: "Informationen konnten nicht gelesen werden",

	filterAll: "Alle",

	sensitiveDataFound: "Sensible Daten gefunden, die besser verborgen werden sollten",
	revealInFinder: "Im Finder anzeigen",

	typeCode: "Code",
	typeImages: "Bilder",
	typeDocuments: "Dokumente",
	typeConfig: "Konfig",
	typeStyles: "Stile",
	typeHTML: "HTML",
	typeOther: "Sonstige",

	statsTitle: "Freigegebener Speicher",
	statsTotal: "Gesamt",
	statsNoData: "Keine Bereinigung aufgezeichnet",
};

export default de;
