import { ApplicationMenu, BrowserView, BrowserWindow, Screen } from "electrobun/bun";
import { Effect, Layer } from "effect";
import { CoreLayer } from "../core";
import { AppUpdater } from "./updater";
import { type DesktopRPC, type WebviewSender, makeRequestHandlers } from "./rpc";
import { AppUpdaterLive } from "./updater-live";

const MIN_WIDTH = 640;
const MIN_HEIGHT = 480;

/** Window, RPC bridge, menu and update checks. Lives until the process is interrupted. */
const DesktopApp = Layer.effectDiscard(
	Effect.gen(function* () {
		// Messages go through `rpc`, which only exists once the handlers are built
		const send: WebviewSender = {
			scanProgress: (p) => rpc.send.scanProgress(p),
			error: (p) => rpc.send.error(p),
			updateAvailable: (p) => rpc.send.updateAvailable(p),
			updateReady: (p) => rpc.send.updateReady(p),
			updateError: (p) => rpc.send.updateError(p),
		};
		const { requests, checkForUpdate } = yield* makeRequestHandlers(send);
		const updater = yield* AppUpdater;
		const run = Effect.runPromiseWith(yield* Effect.context<AppUpdater>());

		let mainWin: InstanceType<typeof BrowserWindow> | null = null;

		const rpc: ReturnType<typeof BrowserView.defineRPC<DesktopRPC>> = BrowserView.defineRPC<DesktopRPC>({
			maxRequestTime: 300000,
			handlers: {
				requests: {
					...requests,
					getWindowPosition: async () => {
						const pos = mainWin!.getPosition();
						return { x: pos.x, y: pos.y };
					},
					moveWindow: async ({ x, y }) => {
						mainWin!.setPosition(x, y);
						return { success: true };
					},
				},
				messages: {},
			},
		});

		const workArea = Screen.getPrimaryDisplay().workArea;
		const win = new BrowserWindow({
			title: "Ingombro",
			url: "views://mainview/index.html",
			frame: {
				width: 1100,
				height: 750,
				x: workArea.x + Math.round((workArea.width - 1100) / 2),
				y: workArea.y + Math.round((workArea.height - 750) / 2),
			},
			titleBarStyle: "hiddenInset",
			transparent: false,
			rpc,
		});
		mainWin = win;

		// --- Enforce minimum window size ---
		win.on("resize", (event: any) => {
			const { width, height } = event.data;
			if (width < MIN_WIDTH || height < MIN_HEIGHT) {
				win.setSize(Math.max(width, MIN_WIDTH), Math.max(height, MIN_HEIGHT));
			}
		});

		// --- Application Menu (enables Cmd+C, Cmd+V, etc.) ---
		ApplicationMenu.setApplicationMenu([
			{
				label: "Ingombro",
				submenu: [
					{ role: "about" },
					{ type: "separator" },
					{ label: "Check for Updates…", action: "check-for-updates" },
					{ type: "separator" },
					{ role: "hide", accelerator: "CmdOrCtrl+H" },
					{ role: "hideOthers", accelerator: "CmdOrCtrl+Shift+H" },
					{ role: "showAll" },
					{ type: "separator" },
					{ role: "quit", accelerator: "CmdOrCtrl+Q" },
				],
			},
			{
				label: "Edit",
				submenu: [
					{ role: "undo", accelerator: "CmdOrCtrl+Z" },
					{ role: "redo", accelerator: "CmdOrCtrl+Shift+Z" },
					{ type: "separator" },
					{ role: "cut", accelerator: "CmdOrCtrl+X" },
					{ role: "copy", accelerator: "CmdOrCtrl+C" },
					{ role: "paste", accelerator: "CmdOrCtrl+V" },
					{ role: "selectAll", accelerator: "CmdOrCtrl+A" },
				],
			},
		]);

		// --- Handle "Check for Updates" menu action ---
		ApplicationMenu.on("application-menu-clicked", (event: any) => {
			if (event?.action !== "check-for-updates") return;
			void run(
				Effect.log("[updater] Manual check from menu...").pipe(
					Effect.andThen(checkForUpdate),
					Effect.catchTag("UpdaterError", (e) => Effect.logError("[updater] Menu check error:", e.cause)),
				),
			);
		});

		// --- Auto-check for updates on startup (after a short delay) ---
		yield* Effect.log("[updater] Auto-checking for updates...").pipe(
			Effect.andThen(updater.check),
			Effect.tap((info) =>
				info.updateAvailable
					? Effect.log(`[updater] Update available: ${info.version}`).pipe(
							Effect.andThen(Effect.sync(() => rpc.send.updateAvailable({ version: info.version }))),
						)
					: Effect.log("[updater] App is up to date"),
			),
			Effect.catchTag("UpdaterError", (e) => Effect.logError("[updater] Auto-check failed:", e.cause)),
			Effect.delay("5 seconds"),
			Effect.forkScoped,
		);
	}),
);

// Electrobun runs this file in a Worker and its launcher owns the process: signals and exit are
// handled on the main thread, so no runMain here (it would install signal handlers and call
// process.exit from the Worker).
Effect.runFork(
	DesktopApp.pipe(
		Layer.provide(Layer.mergeAll(CoreLayer, AppUpdaterLive)),
		Layer.launch,
		Effect.tapCause((cause) => Effect.logError("[ingombro] Desktop app failed:", cause)),
	),
);
