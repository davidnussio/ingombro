import { Updater } from "electrobun/bun";
import { Effect, Layer } from "effect";
import { AppUpdater, UpdaterError } from "./updater";

const attempt = <A>(operation: string, f: () => Promise<A>) =>
	Effect.tryPromise({ try: f, catch: (cause) => new UpdaterError({ operation, cause }) }).pipe(
		Effect.withSpan(`AppUpdater.${operation}`),
	);

/** Electrobun's self-updater. */
export const AppUpdaterLive = Layer.succeed(
	AppUpdater,
	AppUpdater.of({
		check: attempt("check", () => Updater.checkForUpdate()),
		download: attempt("download", async () => {
			await Updater.downloadUpdate();
			const info = Updater.updateInfo();
			return info?.updateReady ? info.version : undefined;
		}),
		apply: attempt("apply", () => Updater.applyUpdate()),
		localInfo: attempt("localInfo", () => Updater.getLocallocalInfo()),
	}),
);
