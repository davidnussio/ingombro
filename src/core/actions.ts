import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "fs";
import { basename, join } from "path";
import { homedir } from "os";
import { $ } from "bun";
import { expandPath } from "./paths";
import { loadSettings } from "./settings";
import { loadCacheStore, removeDirFromCacheEntry, saveCacheStore } from "./cache";
import { getPathSize } from "./scanner";
import { logger } from "./log";
import type { AppSettings } from "./types";

/** Pick a name that doesn't clash inside `dir`. */
function uniqueTarget(dir: string, name: string): string {
	let target = join(dir, name);
	for (let i = 2; existsSync(target); i++) target = join(dir, `${name} ${i}`);
	return target;
}

/**
 * Move to the Trash. macOS: Finder first (keeps "Put Back"), then a plain move into ~/.Trash.
 * Linux: freedesktop Trash. Never falls back to a permanent delete: if nothing works it throws.
 */
async function moveToTrash(resolved: string) {
	if (process.platform === "darwin") {
		try {
			const escaped = resolved.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
			await $`osascript -e ${`tell application "Finder" to delete POSIX file "${escaped}"`}`.quiet();
			return;
		} catch {}
		const trashDir = join(homedir(), ".Trash");
		renameSync(resolved, uniqueTarget(trashDir, basename(resolved)));
		return;
	}
	const trashRoot = join(process.env.XDG_DATA_HOME || join(homedir(), ".local/share"), "Trash");
	const filesDir = join(trashRoot, "files");
	const infoDir = join(trashRoot, "info");
	mkdirSync(filesDir, { recursive: true });
	mkdirSync(infoDir, { recursive: true });
	const target = uniqueTarget(filesDir, basename(resolved));
	renameSync(resolved, target);
	const deletionDate = new Date().toISOString().slice(0, 19);
	writeFileSync(join(infoDir, basename(target) + ".trashinfo"), `[Trash Info]\nPath=${encodeURI(resolved)}\nDeletionDate=${deletionDate}\n`);
}

export async function removePath(resolved: string, mode: AppSettings["deleteMode"]) {
	if (mode === "trash") await moveToTrash(resolved);
	else rmSync(resolved, { recursive: true, force: true });
}

export interface BatchDeleteResult {
	success: boolean;
	deletedCount: number;
	deletedSize: number;
	deletedPaths: string[];
	errors: string[];
}

/**
 * Delete paths (trash or permanent per settings) and prune them from every cached tree.
 * `knownSizes` avoids re-walking directories whose size the caller already knows.
 */
export async function batchDelete(
	paths: string[],
	opts: { knownSizes?: Map<string, number>; onItem?: (path: string, index: number) => void } = {},
): Promise<BatchDeleteResult> {
	const settings = await loadSettings();
	const store = await loadCacheStore();
	let deletedCount = 0;
	let deletedSize = 0;
	const deletedPaths: string[] = [];
	const errors: string[] = [];
	let cacheModified = false;

	for (const [i, p] of paths.entries()) {
		opts.onItem?.(p, i);
		try {
			const resolved = expandPath(p);
			if (!statSync(resolved, { throwIfNoEntry: false })) {
				errors.push(`${p}: not found`);
				continue;
			}
			const size = opts.knownSizes?.get(p) ?? getPathSize(resolved);
			await removePath(resolved, settings.deleteMode);
			deletedCount++;
			deletedSize += size;
			deletedPaths.push(resolved);
			for (const cacheEntry of store.entries) {
				if (removeDirFromCacheEntry(cacheEntry, resolved)) cacheModified = true;
			}
		} catch (e: any) {
			errors.push(`${p}: ${e.message}`);
		}
	}

	if (cacheModified) await saveCacheStore(store);
	return { success: errors.length === 0, deletedCount, deletedSize, deletedPaths, errors };
}

/** Directory suggestions for path autocomplete (max 20, "~"-prefixed when under home). */
export function listDirSuggestions(partial: string): string[] {
	try {
		const input = partial || "~";
		const expanded = expandPath(input);
		let dirToList: string;
		let prefix = "";
		const isExactDir = statSync(expanded, { throwIfNoEntry: false })?.isDirectory();
		if (input.endsWith("/") || isExactDir) {
			dirToList = expanded;
		} else {
			dirToList = join(expanded, "..");
			prefix = basename(expanded).toLowerCase();
		}
		if (!statSync(dirToList, { throwIfNoEntry: false })?.isDirectory()) return [];

		const home = homedir();
		const suggestions: string[] = [];
		for (const item of readdirSync(dirToList, { withFileTypes: true })) {
			if (!item.isDirectory() || item.name.startsWith(".")) continue;
			if (prefix && !item.name.toLowerCase().startsWith(prefix)) continue;
			const fullPath = join(dirToList, item.name);
			suggestions.push(fullPath.startsWith(home) ? "~" + fullPath.slice(home.length) : fullPath);
			if (suggestions.length >= 20) break;
		}
		return suggestions.sort();
	} catch (e) {
		logger.error("[ingombro] listDir error:", e);
		return [];
	}
}

export function isDirectory(p: string): boolean {
	try {
		return !!statSync(expandPath(p), { throwIfNoEntry: false })?.isDirectory();
	} catch {
		return false;
	}
}

/** Reveal in Finder (file) or open (directory). macOS: `open`, Linux: `xdg-open`. */
export async function revealInFinder(filePath: string): Promise<boolean> {
	try {
		const resolved = expandPath(filePath);
		const stat = statSync(resolved, { throwIfNoEntry: false });
		if (!stat) return false;
		if (process.platform === "darwin") {
			if (stat.isDirectory()) await $`open ${resolved}`.quiet();
			else await $`open -R ${resolved}`.quiet();
		} else {
			await $`xdg-open ${stat.isDirectory() ? resolved : join(resolved, "..")}`.quiet();
		}
		return true;
	} catch {
		return false;
	}
}

// --- envsec integration ---

export async function isEnvsecAvailable(): Promise<boolean> {
	try {
		const { EnvsecClient } = await import("@envsec/sdk");
		const client = await EnvsecClient.create({ context: "__envsec_check__" });
		await client.close();
		return true;
	} catch {
		return false;
	}
}

export function parseEnvFile(content: string): [string, string][] {
	const entries: [string, string][] = [];
	for (const line of content.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const eqIdx = trimmed.indexOf("=");
		if (eqIdx < 1) continue;
		const key = trimmed.slice(0, eqIdx).trim();
		let value = trimmed.slice(eqIdx + 1).trim();
		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1);
		}
		if (key && value) entries.push([key, value]);
	}
	return entries;
}

/** Import a .env file into an envsec context, then delete the file and prune the cache. */
export async function importEnvToEnvsec(filePath: string, context: string): Promise<{ success: boolean; imported: number; error?: string }> {
	try {
		const resolved = expandPath(filePath);
		const entries = parseEnvFile(readFileSync(resolved, "utf-8"));
		if (entries.length === 0) return { success: false, imported: 0, error: "No valid entries found in file" };

		const { EnvsecClient } = await import("@envsec/sdk");
		const client = await EnvsecClient.create({ context });
		let imported = 0;
		for (const [key, value] of entries) {
			await client.set(key, value);
			imported++;
		}
		await client.close();

		rmSync(resolved, { force: true });
		const store = await loadCacheStore();
		let cacheModified = false;
		for (const cacheEntry of store.entries) {
			if (removeDirFromCacheEntry(cacheEntry, resolved)) cacheModified = true;
		}
		if (cacheModified) await saveCacheStore(store);
		logger.log(`[envsec] Imported ${imported} secrets from ${resolved} to context "${context}"`);
		return { success: true, imported };
	} catch (e: any) {
		logger.error("[envsec] Import error:", e);
		return { success: false, imported: 0, error: e.message };
	}
}
