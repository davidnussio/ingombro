import type { Translations } from "./types";

const es: Translations = {
	welcomeDesc: "Analiza el espacio en disco y limpia directorios innecesarios.",
	scanLabel: "Directorio a escanear",
	scanButton: "Escanear",
	dirNotFound: "El directorio no existe",

	scanningText: "Escaneando...",
	cancelScan: "Cancelar",
	scanCancelled: "Escaneo cancelado",

	rescanButton: "Re-escanear",
	backTitle: "Volver",
	navigation: "Navegación",

	cleanAnalyzing: "Analizando directorios…",
	cleanRecoverable: (size, count) => `${size} recuperables de ${count} carpeta${count === 1 ? "" : "s"} de proyecto`,
	cleanDetails: "Ver detalles",

	smartCleanTitle: "✨ Smart Clean",
	cleanModalDesc: "Carpetas de proyecto eliminables para liberar espacio.",
	selectAll: "Seleccionar todo",
	cleanSelected: (count) => `${count} seleccionada${count === 1 ? "" : "s"}`,
	cleanSelectedWithSize: (size) => `Limpiar selección (${size})`,
	cleaningInProgress: "Limpiando…",
	cancel: "Cancelar",

	deleteConfirmTitle: "Confirmar eliminación",
	deleteConfirmMessage: (name, size) => `¿Estás seguro de que quieres eliminar "${name}" (${size})? Esta acción es irreversible.`,
	deleteConfirmMessageTrash: (name, size) => `¿Estás seguro de que quieres eliminar "${name}" (${size})? El elemento se moverá a la Papelera.`,
	deleteButton: "Eliminar",

	freedJust: "Liberados",
	freedSessionTotal: "Total de sesión:",

	infoTitle: "Info",
	loading: "Cargando…",
	loadError: "No se pudo cargar la información",
	connectionError: "Error de conexión",
	errorTitle: "Error",
	closeEsc: "Cerrar (Esc)",

	details: "Detalles",
	size: "Tamaño",
	files: "Archivos",
	folders: "Carpetas",
	lastModified: "Última modificación",
	created: "Creación",
	largestFile: "Archivo más grande",
	newestModified: "Modificado más recientemente",
	typeDistribution: "Distribución por tipo",
	preview: "Vista previa",
	path: "Ruta",

	settingsTitle: "Ajustes",
	maxCache: "Caché máximas",
	scanDepth: "Profundidad de escaneo",
	deleteMode: "Eliminación",
	deleteModeTrash: "Papelera",
	deleteModePermanent: "Permanente",
	language: "Idioma",

	openCache: "Abrir caché",
	scanCache: "Escanear",
	removeCache: "Eliminar",

	errorPrefix: "Error:",
	scanFailed: "escaneo fallido",
	deleteError: "Error durante la eliminación:",
	unknownError: "desconocido",
	notFound: "no encontrado",
	cannotReadInfo: "No se pudo leer la información",

	filterAll: "Todos",

	sensitiveDataFound: "Se encontraron datos sensibles que deberían ocultarse",
	revealInFinder: "Mostrar en Finder",

	typeCode: "Código",
	typeImages: "Imágenes",
	typeDocuments: "Documentos",
	typeConfig: "Config",
	typeStyles: "Estilos",
	typeHTML: "HTML",
	typeOther: "Otros",

	statsTitle: "Espacio liberado",
	statsTotal: "Total",
	statsNoData: "Ninguna limpieza registrada",
};

export default es;
