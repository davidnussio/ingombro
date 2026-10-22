import { Context, Effect, FileSystem, Layer, Schema } from "effect";
import { AppPaths } from "./paths";
import { DEFAULT_SETTINGS, SettingsFile, type AppSettings } from "./types";

export function normalizeSettings(input: { maxCacheEntries: number; deleteMode: string; maxDepth: number }): AppSettings {
	return {
		maxCacheEntries: Math.max(1, Math.min(50, input.maxCacheEntries)),
		deleteMode: input.deleteMode === "permanent" ? "permanent" : "trash",
		maxDepth: Math.max(1, Math.min(30, input.maxDepth)),
	};
}

/** settings.json: unreadable or invalid files fall back to the defaults, write failures are logged. */
export class Settings extends Context.Service<
	Settings,
	{
		readonly get: Effect.Effect<AppSettings>;
		save(settings: AppSettings): Effect.Effect<void>;
	}
>()("ingombro/core/Settings") {
	static readonly layer = Layer.effect(
		Settings,
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const paths = yield* AppPaths;
			const SettingsJson = Schema.fromJsonString(SettingsFile, { space: 2 });
			const decode = Schema.decodeUnknownEffect(SettingsJson);
			const encode = Schema.encodeEffect(SettingsJson);

			const get = fs.readFileString(paths.settingsFile).pipe(
				Effect.flatMap(decode),
				Effect.orElseSucceed((): AppSettings => ({ ...DEFAULT_SETTINGS })),
				Effect.withSpan("Settings.get"),
			);

			const save = Effect.fn("Settings.save")(
				function* (settings: AppSettings) {
					yield* paths.ensureAppDir;
					yield* fs.writeFileString(paths.settingsFile, yield* encode(settings));
				},
				Effect.catch((e) => Effect.logError("[ingombro] Failed to save settings:", e)),
			);

			return Settings.of({ get, save });
		}),
	);
}
