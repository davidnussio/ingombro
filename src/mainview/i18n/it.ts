import type { Translations } from "./types";

const it: Translations = {
	welcomeDesc: "Analizza lo spazio su disco e pulisci le directory inutili.",
	scanLabel: "Directory da scansionare",
	scanButton: "Scansiona",
	dirNotFound: "La directory non esiste",

	scanningText: "Scansione in corso...",
	cancelScan: "Interrompi",
	scanCancelled: "Scansione interrotta",

	rescanButton: "Riscansiona",
	backTitle: "Torna indietro",
	navigation: "Navigazione",

	cleanAnalyzing: "Analisi cartelle in corso…",
	cleanRecoverable: (size, count) => `${size} recuperabili da ${count} cartell${count === 1 ? "a" : "e"} di progetto`,
	cleanDetails: "Vedi dettagli",

	smartCleanTitle: "✨ Smart Clean",
	cleanModalDesc: "Cartelle di progetto eliminabili per recuperare spazio.",
	selectAll: "Seleziona tutto",
	cleanSelected: (count) => `${count} selezionat${count === 1 ? "a" : "e"}`,
	cleanSelectedWithSize: (size) => `Pulisci selezionati (${size})`,
	cleaningInProgress: "Pulizia in corso…",
	cancel: "Annulla",

	deleteConfirmTitle: "Conferma eliminazione",
	deleteConfirmMessage: (name, size) => `Sei sicuro di voler eliminare "${name}" (${size})? Questa azione è irreversibile.`,
	deleteButton: "Elimina",

	freedJust: "Liberati",
	freedSessionTotal: "Totale sessione:",

	infoTitle: "Info",
	loading: "Caricamento…",
	loadError: "Impossibile caricare le informazioni",
	connectionError: "Errore di connessione",
	errorTitle: "Errore",
	closeEsc: "Chiudi (Esc)",

	details: "Dettagli",
	size: "Dimensione",
	files: "File",
	folders: "Cartelle",
	lastModified: "Ultima modifica",
	created: "Creazione",
	largestFile: "File più grande",
	newestModified: "Modificato più di recente",
	typeDistribution: "Distribuzione tipi",
	preview: "Anteprima",
	path: "Percorso",

	settingsTitle: "Impostazioni",
	maxCache: "Cache massime",
	scanDepth: "Profondità scansione",
	deleteMode: "Eliminazione",
	deleteModeTrash: "Cestino",
	deleteModePermanent: "Definitiva",
	language: "Lingua",

	openCache: "Apri cache",
	scanCache: "Scansiona",
	removeCache: "Rimuovi",

	errorPrefix: "Errore:",
	scanFailed: "scansione fallita",
	deleteError: "Errore durante l'eliminazione:",
	unknownError: "sconosciuto",
	notFound: "non trovato",
	cannotReadInfo: "Impossibile leggere le informazioni",

	filterAll: "Tutti",

	typeCode: "Codice",
	typeImages: "Immagini",
	typeDocuments: "Documenti",
	typeConfig: "Config",
	typeStyles: "Stili",
	typeHTML: "HTML",
	typeOther: "Altro",
};

export default it;
