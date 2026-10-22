import { Updater } from "electrobun/bun";
import { Context, Effect, Layer, Schema } from "effect";
import { causeMessage } from "../core";

export class UpdaterError extends Schema.TaggedError<UpdaterError>()("UpdaterError", {
	operation: Schema.String,
	cause: Schema.Defect(),
}) {
	override get message() {
		return causeMessage(this.cause);
	}
}

type UpdateInfo = Awaited<ReturnType<typeof Updater.checkForUpdate>>;
type LocalInfo = Awaited<ReturnType<typeof Updater.getLocallocalInfo>>;

const attempt = <A>(operation: string, f: () => Promise<A>) =>
	Effect.tryPromise({ try: f, catch: (cause) => new UpdaterError({ operation, cause }) }).pipe(
		Effect.withSpan(`AppUpdater.${operation}`),
	);

/** Electrobun's self-updater, with typed failures. */
export class AppUpdater extends Context.Service<
	AppUpdater,
	{
		readonly check: Effect.Effect<UpdateInfo, UpdaterError>;
		/** Downloads the update; returns the version when it is ready to apply. */
		readonly download: Effect.Effect<string | undefined, UpdaterError>;
		readonly apply: Effect.Effect<void, UpdaterError>;
		readonly localInfo: Effect.Effect<LocalInfo, UpdaterError>;
	}
>()("ingombro/bun/AppUpdater") {
	static readonly layer = Layer.succeed(
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
}
