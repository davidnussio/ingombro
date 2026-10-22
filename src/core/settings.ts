import { join } from "path";
import { APP_DIR, ensureAppDir } from "./paths";
import { DEFAULT_SETTINGS, type AppSettings } from "./types";

const SETTINGS_FILE = join(APP_DIR, "settings.json");

export async function loadSettings(): Promise<AppSettings> {
	try {
		ensureAppDir();
		if (await Bun.file(SETTINGS_FILE).exists()) {
			const parsed = await Bun.file(SETTINGS_FILE).json();
			return { ...DEFAULT_SETTINGS, ...parsed };
		}
	} catch {}
	return { ...DEFAULT_SETTINGS };
}

export function normalizeSettings(input: { maxCacheEntries: number; deleteMode: string; maxDepth: number }): AppSettings {
	return {
		maxCacheEntries: Math.max(1, Math.min(50, input.maxCacheEntries)),
		deleteMode: input.deleteMode === "permanent" ? "permanent" : "trash",
		maxDepth: Math.max(1, Math.min(30, input.maxDepth)),
	};
}

export async function saveSettings(settings: AppSettings) {
	try {
		ensureAppDir();
		await Bun.write(SETTINGS_FILE, JSON.stringify(settings, null, 2));
	} catch (e) {
		console.error("[ingombro] Failed to save settings:", e);
	}
}
