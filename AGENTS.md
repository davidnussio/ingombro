# Ingombro: agent guide

Disk space analyzer with two front ends sharing one Effect core:

- `src/core/`: Effect services (scanner, cache, settings, stats, Smart Clean, actions). Runtime-agnostic between the two UIs.
- `src/bun/index.ts`: Electrobun main process. The webview's RPC handlers live in `src/bun/rpc.ts` (no Electrobun imports, so they also run in the UI preview).
- `src/mainview/`: Electrobun webview (browser code, DOM + canvas).
- `src/tui/`: terminal UI built on `@opentui/core`, entry point `src/tui/main.ts`.

Commands (Bun only, no Node/pnpm):

| Task       | Command             |
| ---------- | ------------------- |
| Typecheck  | `bun run typecheck` |
| Tests      | `bun test`          |
| TUI        | `bun run tui`       |
| Desktop    | `bun run dev`       |
| UI preview | `bun run ui:preview` (webview in a browser at :5173, real core, throwaway data dir + demo tree) |
| TUI binary | `bun run build:tui` |

`bun test` is rooted at `src/` by `bunfig.toml`, so it never picks up the vendored test suites.

## Vendored reference code: `repos/`

`repos/` holds read-only copies of upstream libraries, added as squashed git subtrees:

- `repos/effect`: Effect-TS monorepo (`effect`, `@effect/platform-bun`, ...).

Rules:

- `repos/` is **reference material only**. Do not edit anything under it unless explicitly asked.
- Never import from `repos/` in application code. Keep importing the normal packages (`effect`, `@effect/platform-bun`).
- When writing or reviewing Effect code, prefer patterns found in the vendored source, tests and docs over guessed APIs or web snippets. Effect 4 renamed and removed many v3 APIs, so memorized v3 code is usually wrong.
- The subtree tracks Effect's `main` branch and can be a patch release ahead of the version pinned in `package.json`. If an API seems missing at runtime, check `node_modules/effect` too.

Update a subtree (lands as a single squashed commit):

```sh
git subtree pull --prefix=repos/effect https://github.com/Effect-TS/effect.git main --squash
```

## Effect

Before writing Effect code, read `repos/effect/LLMS.md`, then the relevant example under `repos/effect/ai-docs/src/`. Module sources are in `repos/effect/packages/effect/src/` (`Effect.ts`, `Layer.ts`, `Schema.ts`, `FileSystem.ts`, ...); Bun platform layers are in `repos/effect/packages/platform/bun/src/`. The v3 to v4 migration notes are in `repos/effect/MIGRATION.md` and `repos/effect/migration/`.

Project pattern files, distilled from the vendored source, live in `agent-patterns/`:

- `agent-patterns/effect-services.md`: services, layers, `Effect.fn`, running effects from non-Effect code.
- `agent-patterns/effect-errors-and-schema.md`: tagged errors, Schema models, decoding persisted JSON.
- `agent-patterns/effect-platform.md`: `FileSystem`, `Path`, `ChildProcess`, interruption, fibers, logging, CLI.
- `agent-patterns/effect-testing.md`: testing services with `bun:test`.

Project conventions:

- All I/O and side-effecting logic lives in Effect services (`Context.Service` + static `layer`). Pure helpers (formatting, tree manipulation, rule tables) stay plain functions.
- Errors are `Schema.TaggedError` classes in `src/core/errors.ts`; recover with `Effect.catchTag`. Do not throw.
- Data shapes are `Schema` definitions in `src/core/types.ts`; types are derived from them. Persisted JSON (settings, cache, stats) is decoded with Schema.
- Cancellation is fiber interruption (`Fiber.interrupt`, `FiberHandle`), never boolean tokens.
- Logging goes through `Effect.log*`. The TUI silences the logger because stdout belongs to the renderer.
- Non-Effect boundaries (Electrobun RPC handlers, OpenTUI key handlers, DOM events) run effects through a `ManagedRuntime` or `Effect.runForkWith`/`Effect.runPromiseWith` with a captured context. Keep those boundaries thin.
- `CoreLayer` in `src/core/layer.ts` wires every core service with `BunServices.layer`.
- Never confirm delete / Smart Clean actions while testing, even on demo data: open the dialog and cancel. Delete dialogs focus Cancel by default.
- Directory walks list folders asynchronously and pause every 50ms (`makeEventLoopBreather`): a synchronous walk can freeze the process on OS-stalled folders and block the cancel request.
