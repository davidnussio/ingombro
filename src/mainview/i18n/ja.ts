import type { Translations } from "./types";

const ja: Translations = {
	welcomeDesc: "ディスク容量を分析し、不要なディレクトリを削除します。",
	scanLabel: "スキャンするディレクトリ",
	scanButton: "スキャン",
	dirNotFound: "ディレクトリが存在しません",

	scanningText: "スキャン中...",
	cancelScan: "中止",
	scanCancelled: "スキャンが中止されました",

	rescanButton: "再スキャン",
	backTitle: "戻る",
	navigation: "ナビゲーション",

	cleanAnalyzing: "プロジェクトを分析中…",
	cleanRecoverable: (size, count) => `${count}個のプロジェクトフォルダから${size}を回収可能`,
	cleanDetails: "詳細を表示",

	smartCleanTitle: "🧹 Smart Clean",
	cleanModalDesc: "スペースを解放するために削除可能なプロジェクトフォルダ。",
	selectAll: "すべて選択",
	cleanSelected: (count) => `${count}件選択中`,
	cleanSelectedWithSize: (size) => `選択項目を削除 (${size})`,
	cleaningInProgress: "削除中…",
	cancel: "キャンセル",

	deleteConfirmTitle: "削除の確認",
	deleteConfirmMessage: (name, size) => `「${name}」(${size}) を削除してもよろしいですか？この操作は元に戻せません。`,
	deleteButton: "削除",

	freedJust: "解放済み",
	freedSessionTotal: "セッション合計:",

	infoTitle: "情報",
	loading: "読み込み中…",
	loadError: "情報を読み込めませんでした",
	connectionError: "接続エラー",
	errorTitle: "エラー",
	closeEsc: "閉じる (Esc)",

	details: "詳細",
	size: "サイズ",
	files: "ファイル",
	folders: "フォルダ",
	lastModified: "最終更新",
	created: "作成日",
	largestFile: "最大ファイル",
	newestModified: "最近更新されたファイル",
	typeDistribution: "種類の分布",
	preview: "プレビュー",
	path: "パス",

	settingsTitle: "設定",
	maxCache: "最大キャッシュ数",
	scanDepth: "スキャン深度",
	deleteMode: "削除方法",
	deleteModeTrash: "ゴミ箱",
	deleteModePermanent: "完全削除",
	language: "言語",

	openCache: "キャッシュを開く",
	scanCache: "スキャン",
	removeCache: "削除",

	errorPrefix: "エラー:",
	scanFailed: "スキャン失敗",
	deleteError: "削除中にエラーが発生:",
	unknownError: "不明",
	notFound: "見つかりません",
	cannotReadInfo: "情報を読み取れませんでした",

	typeCode: "コード",
	typeImages: "画像",
	typeDocuments: "ドキュメント",
	typeConfig: "設定",
	typeStyles: "スタイル",
	typeHTML: "HTML",
	typeOther: "その他",
};

export default ja;
