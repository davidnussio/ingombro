import type { Translations } from "./types";

const fr: Translations = {
	welcomeDesc: "Analysez l'espace disque et nettoyez les répertoires inutiles.",
	scanLabel: "Répertoire à analyser",
	scanButton: "Analyser",
	dirNotFound: "Le répertoire n'existe pas",

	scanningText: "Analyse en cours...",
	cancelScan: "Annuler",
	scanCancelled: "Analyse annulée",

	rescanButton: "Ré-analyser",
	backTitle: "Retour",
	navigation: "Navigation",

	cleanAnalyzing: "Analyse des répertoires en cours…",
	cleanRecoverable: (size, count) => `${size} récupérables dans ${count} dossier${count === 1 ? "" : "s"} de projet`,
	cleanDetails: "Voir les détails",

	smartCleanTitle: "✨ Smart Clean",
	cleanModalDesc: "Dossiers de projet supprimables pour libérer de l'espace.",
	selectAll: "Tout sélectionner",
	cleanSelected: (count) => `${count} sélectionné${count === 1 ? "" : "s"}`,
	cleanSelectedWithSize: (size) => `Nettoyer la sélection (${size})`,
	cleaningInProgress: "Nettoyage en cours…",
	cancel: "Annuler",

	deleteConfirmTitle: "Confirmer la suppression",
	deleteConfirmMessage: (name, size) => `Êtes-vous sûr de vouloir supprimer « ${name} » (${size}) ? Cette action est irréversible.`,
	deleteConfirmMessageTrash: (name, size) => `Êtes-vous sûr de vouloir supprimer « ${name} » (${size}) ? L'élément sera déplacé dans la Corbeille.`,
	deleteButton: "Supprimer",

	freedJust: "Libérés",
	freedSessionTotal: "Total de session :",

	infoTitle: "Info",
	loading: "Chargement…",
	loadError: "Impossible de charger les informations",
	connectionError: "Erreur de connexion",
	errorTitle: "Erreur",
	closeEsc: "Fermer (Esc)",

	details: "Détails",
	size: "Taille",
	files: "Fichiers",
	folders: "Dossiers",
	lastModified: "Dernière modification",
	created: "Création",
	largestFile: "Plus gros fichier",
	newestModified: "Modifié le plus récemment",
	typeDistribution: "Répartition par type",
	preview: "Aperçu",
	path: "Chemin",

	settingsTitle: "Paramètres",
	maxCache: "Caches max",
	scanDepth: "Profondeur d'analyse",
	deleteMode: "Suppression",
	deleteModeTrash: "Corbeille",
	deleteModePermanent: "Définitive",
	language: "Langue",

	openCache: "Ouvrir le cache",
	scanCache: "Analyser",
	removeCache: "Supprimer",

	errorPrefix: "Erreur :",
	scanFailed: "analyse échouée",
	deleteError: "Erreur lors de la suppression :",
	unknownError: "inconnu",
	notFound: "introuvable",
	cannotReadInfo: "Impossible de lire les informations",

	filterAll: "Tous",

	sensitiveDataFound: "Données sensibles trouvées qu'il vaut mieux masquer",
	revealInFinder: "Afficher dans le Finder",

	typeCode: "Code",
	typeImages: "Images",
	typeDocuments: "Documents",
	typeConfig: "Config",
	typeStyles: "Styles",
	typeHTML: "HTML",
	typeOther: "Autres",

	statsTitle: "Espace libéré",
	statsTotal: "Total",
	statsNoData: "Aucun nettoyage enregistré",
};

export default fr;
