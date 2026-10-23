import type { Updater } from "electrobun/bun";
import { Context, Effect, Schema } from "effect";
import { causeMessage } from "../core";

export class UpdaterError extends Schema.TaggedError<UpdaterError>()("UpdaterError", {
	operation: Schema.String,
	cause: Schema.Defect(),
}) {
	override get message() {
		return causeMessage(this.cause);
	}
}

export type UpdateInfo = Awaited<ReturnType<typeof Updater.checkForUpdate>>;
export type LocalInfo = Awaited<ReturnType<typeof Updater.getLocallocalInfo>>;

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
>()("ingombro/bun/AppUpdater") {}
