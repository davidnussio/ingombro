import type { Translations } from "./types";

const pt: Translations = {
	welcomeDesc: "Analise o espaço em disco e limpe diretórios desnecessários.",
	scanLabel: "Diretório para escanear",
	scanButton: "Escanear",
	dirNotFound: "O diretório não existe",

	scanningText: "Escaneando...",
	cancelScan: "Cancelar",
	scanCancelled: "Escaneamento cancelado",

	rescanButton: "Re-escanear",
	backTitle: "Voltar",
	navigation: "Navegação",

	cleanAnalyzing: "Analisando projetos…",
	cleanRecoverable: (size, count) => `${size} recuperáveis de ${count} pasta${count === 1 ? "" : "s"} de projeto`,
	cleanDetails: "Ver detalhes",

	smartCleanTitle: "🧹 Smart Clean",
	cleanModalDesc: "Pastas de projeto removíveis para liberar espaço.",
	selectAll: "Selecionar tudo",
	cleanSelected: (count) => `${count} selecionada${count === 1 ? "" : "s"}`,
	cleanSelectedWithSize: (size) => `Limpar seleção (${size})`,
	cleaningInProgress: "Limpando…",
	cancel: "Cancelar",

	deleteConfirmTitle: "Confirmar exclusão",
	deleteConfirmMessage: (name, size) => `Tem certeza de que deseja excluir "${name}" (${size})? Esta ação é irreversível.`,
	deleteButton: "Excluir",

	freedJust: "Liberados",
	freedSessionTotal: "Total da sessão:",

	infoTitle: "Info",
	loading: "Carregando…",
	loadError: "Não foi possível carregar as informações",
	connectionError: "Erro de conexão",
	errorTitle: "Erro",
	closeEsc: "Fechar (Esc)",

	details: "Detalhes",
	size: "Tamanho",
	files: "Arquivos",
	folders: "Pastas",
	lastModified: "Última modificação",
	created: "Criação",
	largestFile: "Maior arquivo",
	newestModified: "Modificado mais recentemente",
	typeDistribution: "Distribuição por tipo",
	preview: "Pré-visualização",
	path: "Caminho",

	settingsTitle: "Configurações",
	maxCache: "Caches máximos",
	scanDepth: "Profundidade de escaneamento",
	deleteMode: "Exclusão",
	deleteModeTrash: "Lixeira",
	deleteModePermanent: "Permanente",
	language: "Idioma",

	openCache: "Abrir cache",
	scanCache: "Escanear",
	removeCache: "Remover",

	errorPrefix: "Erro:",
	scanFailed: "escaneamento falhou",
	deleteError: "Erro durante a exclusão:",
	unknownError: "desconhecido",
	notFound: "não encontrado",
	cannotReadInfo: "Não foi possível ler as informações",

	typeCode: "Código",
	typeImages: "Imagens",
	typeDocuments: "Documentos",
	typeConfig: "Config",
	typeStyles: "Estilos",
	typeHTML: "HTML",
	typeOther: "Outros",
};

export default pt;
