import { homedir } from "os";
import { join, resolve } from "path";
import { Config, Context, Effect, FileSystem, Layer } from "effect";

/** Resolve `~`, make absolute and strip the trailing slash (except for "/"). */
export function expandPath(p: string): string {
	let result: string;
	if (p.startsWith("~/")) result = join(homedir(), p.slice(2));
	else if (p === "~") result = homedir();
	else result = resolve(p);
	if (result.length > 1 && result.endsWith("/")) result = result.slice(0, -1);
	return result;
}

/** Inverse of expandPath for display: /Users/me/x -> ~/x */
export function prettyPath(p: string): string {
	const home = homedir();
	if (p === home) return "~";
	if (p.startsWith(home + "/")) return "~" + p.slice(home.length);
	return p;
}

/** Location of Ingombro's data files (shared by desktop app and TUI). */
export class AppPaths extends Context.Service<
	AppPaths,
	{
		readonly appDir: string;
		readonly settingsFile: string;
		readonly cacheFile: string;
		readonly statsFile: string;
		/** Older cache locations, migrated once into `cacheFile`. */
		readonly legacyCacheFiles: ReadonlyArray<string>;
		/** mkdir -p the data directory. */
		readonly ensureAppDir: Effect.Effect<void>;
	}
>()("ingombro/core/AppPaths") {
	static readonly make = Effect.fnUntraced(function* (appDir: string) {
		const fs = yield* FileSystem.FileSystem;
		return AppPaths.of({
			appDir,
			settingsFile: join(appDir, "settings.json"),
			cacheFile: join(appDir, "cache.json.gz"),
			statsFile: join(appDir, "stats.json"),
			legacyCacheFiles: [join(homedir(), ".diskscanner_cache.json"), join(appDir, "cache.json")],
			ensureAppDir: fs.makeDirectory(appDir, { recursive: true }).pipe(Effect.ignore),
		});
	});

	/** `~/.ingombro`, overridable with INGOMBRO_HOME (used by tests). */
	static readonly layer = Layer.effect(
		AppPaths,
		Effect.gen(function* () {
			const appDir = yield* Config.String("INGOMBRO_HOME").pipe(
				Config.withDefault(join(homedir(), ".ingombro")),
				Effect.orDie,
			);
			return yield* AppPaths.make(appDir);
		}),
	);

	static readonly layerAt = (appDir: string) => Layer.effect(AppPaths, AppPaths.make(appDir));
}
