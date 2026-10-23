#!/usr/bin/env bun
// Browser preview of the desktop UI, backed by the real core services.
//
//   bun run ui:preview            → http://localhost:5173
//
// Data lives in a throwaway INGOMBRO_HOME (default: $TMPDIR/ingombro-preview) with a demo
// folder tree to scan, and deletes are permanent there, so the real Trash and ~/.ingombro are
// never touched. Set INGOMBRO_HOME yourself to preview against other data.
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { BunRuntime } from "@effect/platform-bun";
import { Effect, Fiber, Layer, PubSub, Stream } from "effect";
import { AppPaths, makeCoreLayer } from "../../src/core";
import { makeRequestHandlers, type WebviewSender } from "../../src/bun/rpc";
import { AppUpdater } from "../../src/bun/updater";
import { makeDemoTree } from "./demo-tree";

const root = resolve(import.meta.dir, "../..");
const port = Number(process.env.PORT ?? 5173);
const home = process.env.INGOMBRO_HOME ?? join(tmpdir(), "ingombro-preview");
const demo = join(home, "demo", "Developer");

if (!process.env.INGOMBRO_HOME) {
	mkdirSync(home, { recursive: true });
	const settings = join(home, "settings.json");
	if (!existsSync(settings)) writeFileSync(settings, JSON.stringify({ deleteMode: "permanent" }));
	if (!existsSync(demo)) makeDemoTree(demo);
}

const PreviewUpdater = Layer.succeed(
	AppUpdater,
	AppUpdater.of({
		check: Effect.succeed({ version: "1.3.0", hash: "", updateAvailable: false, updateReady: false, error: "" } as any),
		download: Effect.succeed(undefined),
		apply: Effect.void,
		localInfo: Effect.succeed({ version: "preview", channel: "dev" } as any),
	}),
);

const shim = join(import.meta.dir, "electroview-shim.ts");
const buildWebview = async () => {
	const result = await Bun.build({
		entrypoints: [join(root, "src/mainview/index.ts")],
		target: "browser",
		plugins: [
			{
				name: "electroview-shim",
				setup(build) {
					build.onResolve({ filter: /^electrobun\/view$/ }, () => ({ path: shim }));
				},
			},
		],
	});
	if (!result.success) throw new AggregateError(result.logs, "webview build failed");
	return result.outputs[0]!.text();
};

const Preview = Layer.effectDiscard(
	Effect.gen(function* () {
		// Every open page gets its own subscription (reloads leave stale connections behind)
		const messages = yield* PubSub.unbounded<string>();
		const push = (name: string) => (payload: unknown) => PubSub.publishUnsafe(messages, JSON.stringify({ name, payload }));
		const send: WebviewSender = {
			scanProgress: push("scanProgress"),
			error: push("error"),
			updateAvailable: push("updateAvailable"),
			updateReady: push("updateReady"),
			updateError: push("updateError"),
		};
		const { requests } = yield* makeRequestHandlers(send);
		const handlers: Record<string, (params: any) => Promise<unknown>> = {
			...requests,
			getWindowPosition: async () => ({ x: 0, y: 0 }),
			moveWindow: async () => ({ success: true }),
		};
		const forkStream = Effect.runForkWith(yield* Effect.context<never>());

		const server = Bun.serve({
			port,
			idleTimeout: 0,
			fetch: async (req) => {
				const url = new URL(req.url);
				if (url.pathname === "/" || url.pathname === "/index.html") {
					const html = (await Bun.file(join(root, "src/mainview/index.html")).text()).replaceAll("views://mainview/", "/");
					return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
				}
				if (url.pathname === "/index.js") {
					return new Response(await buildWebview(), { headers: { "content-type": "text/javascript" } });
				}
				if (url.pathname === "/index.css") return new Response(Bun.file(join(root, "src/mainview/index.css")));
				if (url.pathname.startsWith("/assets/")) return new Response(Bun.file(join(root, "src", url.pathname)));
				if (url.pathname === "/events") {
					let subscription: Fiber.Fiber<void> | undefined;
					const body = new ReadableStream<string>({
						start(controller) {
							subscription = forkStream(
								Stream.fromPubSub(messages).pipe(Stream.runForEach((m) => Effect.sync(() => controller.enqueue(`data: ${m}\n\n`)))),
							);
						},
						cancel() {
							if (subscription) forkStream(Fiber.interrupt(subscription));
						},
					});
					return new Response(body, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
				}
				const rpc = url.pathname.match(/^\/rpc\/(\w+)$/);
				if (rpc && req.method === "POST") {
					const handler = handlers[rpc[1]!];
					if (!handler) return new Response(`unknown request ${rpc[1]}`, { status: 404 });
					return Response.json(await handler(await req.json()));
				}
				return new Response("not found", { status: 404 });
			},
		});
		yield* Effect.addFinalizer(() => Effect.promise(() => server.stop(true)));
		yield* Effect.log(`UI preview on http://localhost:${server.port} (data: ${home}, demo tree: ${demo})`);
	}),
);

Preview.pipe(
	Layer.provide(Layer.mergeAll(makeCoreLayer(AppPaths.layerAt(home)), PreviewUpdater)),
	Layer.launch,
	BunRuntime.runMain,
);
