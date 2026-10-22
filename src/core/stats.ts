import { Context, DateTime, Effect, FileSystem, Layer, Schema } from "effect";
import { AppPaths } from "./paths";
import { StatsData, type StatsSummary } from "./types";

const StatsJson = Schema.fromJsonString(StatsData, { space: 2 });

/** Daily "freed space" history (stats.json), kept for the last 90 days. */
export class Stats extends Context.Service<
	Stats,
	{
		recordDeletion(freedBytes: number, deleteCount: number): Effect.Effect<void>;
		summary(days: number): Effect.Effect<StatsSummary>;
	}
>()("ingombro/core/Stats") {
	static readonly layer = Layer.effect(
		Stats,
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const paths = yield* AppPaths;

			const load = fs.readFileString(paths.statsFile).pipe(
				Effect.flatMap(Schema.decodeUnknownEffect(StatsJson)),
				Effect.orElseSucceed((): StatsData => ({ entries: [] })),
			);

			const save = (data: StatsData) =>
				Effect.gen(function* () {
					yield* paths.ensureAppDir;
					yield* fs.writeFileString(paths.statsFile, yield* Schema.encodeEffect(StatsJson)(data));
				}).pipe(Effect.catch((e) => Effect.logError("[ingombro] Failed to save stats:", e)));

			const recordDeletion = Effect.fn("Stats.recordDeletion")(function* (freedBytes: number, deleteCount: number) {
				const stats = yield* load;
				const today = DateTime.formatIsoDateUtc(yield* DateTime.now);
				const existing = stats.entries.find((e) => e.date === today);
				const entries = existing
					? stats.entries.map((e) =>
							e === existing
								? { ...e, freedBytes: e.freedBytes + freedBytes, deleteCount: e.deleteCount + deleteCount }
								: e,
						)
					: [...stats.entries, { date: today, freedBytes, deleteCount }];
				// Keep last 90 days max
				const sorted = entries.toSorted((a, b) => a.date.localeCompare(b.date));
				yield* save({ entries: sorted.slice(-90) });
			});

			const summary = Effect.fn("Stats.summary")(function* (days: number) {
				const stats = yield* load;
				const now = yield* DateTime.now;
				const cutoff = DateTime.formatIsoDateUtc(DateTime.subtract(now, { days }));
				const entries = stats.entries.filter((e) => e.date >= cutoff);
				return {
					entries,
					totalFreed: entries.reduce((s, e) => s + e.freedBytes, 0),
					totalDeleted: entries.reduce((s, e) => s + e.deleteCount, 0),
				};
			});

			return Stats.of({ recordDeletion, summary });
		}),
	);
}
