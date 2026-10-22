import { join } from "path";
import { APP_DIR, ensureAppDir } from "./paths";
import type { StatsData, StatsEntry } from "./types";

const STATS_FILE = join(APP_DIR, "stats.json");

export async function loadStats(): Promise<StatsData> {
	try {
		ensureAppDir();
		if (await Bun.file(STATS_FILE).exists()) {
			return (await Bun.file(STATS_FILE).json()) as StatsData;
		}
	} catch {}
	return { entries: [] };
}

async function saveStats(data: StatsData) {
	try {
		ensureAppDir();
		await Bun.write(STATS_FILE, JSON.stringify(data, null, 2));
	} catch (e) {
		console.error("[ingombro] Failed to save stats:", e);
	}
}

export async function recordDeletion(freedBytes: number, deleteCount: number) {
	const stats = await loadStats();
	const today = new Date().toISOString().slice(0, 10);
	const existing = stats.entries.find((e) => e.date === today);
	if (existing) {
		existing.freedBytes += freedBytes;
		existing.deleteCount += deleteCount;
	} else {
		stats.entries.push({ date: today, freedBytes, deleteCount });
	}
	// Keep last 90 days max
	stats.entries.sort((a, b) => a.date.localeCompare(b.date));
	if (stats.entries.length > 90) stats.entries = stats.entries.slice(-90);
	await saveStats(stats);
}

export async function getStats(days: number): Promise<{ entries: StatsEntry[]; totalFreed: number; totalDeleted: number }> {
	const stats = await loadStats();
	const cutoff = new Date();
	cutoff.setDate(cutoff.getDate() - days);
	const cutoffStr = cutoff.toISOString().slice(0, 10);
	const entries = stats.entries.filter((e) => e.date >= cutoffStr);
	return {
		entries,
		totalFreed: entries.reduce((s, e) => s + e.freedBytes, 0),
		totalDeleted: entries.reduce((s, e) => s + e.deleteCount, 0),
	};
}
