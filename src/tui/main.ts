#!/usr/bin/env bun
// Ingombro TUI: lazygit-style terminal interface for the Ingombro disk analyzer.
import { createCliRenderer } from "@opentui/core";
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Deferred, Effect, Layer, Option, Runtime } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { CoreLayer, SilentLogger } from "../core";
import { App } from "./app";
import { theme } from "./theme";
import pkg from "../../package.json";

const ingombro = Command.make(
	"ingombro",
	{
		path: Argument.String("path").pipe(
			Argument.withDescription(
				"Folder to analyze. If it was scanned before, the cached result opens instantly (use --rescan to scan again). Without a path, the most recent scan is opened.",
			),
			Argument.optional,
		),
		rescan: Flag.Boolean("rescan").pipe(
			Flag.withAlias("r"),
			Flag.withDescription("Ignore the cache and scan again"),
			Flag.withDefault(false),
		),
	},
	Effect.fn("ingombro")(
		function* ({ path, rescan }) {
			const renderer = yield* Effect.promise(() =>
				createCliRenderer({ exitOnCtrlC: false, useMouse: false, backgroundColor: theme.bg, targetFps: 30 }),
			);
			const exited = yield* Deferred.make<void>();
			const app = yield* App.make(renderer, {
				initialPath: Option.getOrUndefined(path),
				rescan,
				onExit: () => Deferred.doneUnsafe(exited, Effect.void),
			});
			yield* app.start;
			yield* Deferred.await(exited);
		},
		// stdout belongs to the renderer: silence core logging
		Effect.provide(CoreLayer.pipe(Layer.provideMerge(SilentLogger))),
	),
).pipe(
	Command.withDescription(
		"Analyze disk space and clean up bloated folders. Data (cache, settings, stats) is shared with the desktop app in ~/.ingombro. Press ? inside the app for keybindings.",
	),
);

ingombro.pipe(
	Command.run({ version: pkg.version }),
	Effect.provide(BunServices.layer),
	BunRuntime.runMain({
		// The renderer leaves stdin handles open: always exit once the app is done
		teardown: (exit, onExit) =>
			Runtime.defaultTeardown(exit, (code) => {
				onExit(code);
				process.exit(code);
			}),
	}),
);
