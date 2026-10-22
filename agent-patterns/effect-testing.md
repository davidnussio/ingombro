# Testing Effect services with bun:test

Sources: `repos/effect/ai-docs/src/09_testing/` (written for `@effect/vitest`; the same ideas apply), `src/core/core.test.ts`.

The project uses `bun test` (rooted at `src/` by `bunfig.toml`). There is no `@effect/vitest`: run effects with `Effect.runPromise` and provide a test layer.

```ts
const appDir = join(mkdtempSync(join(tmpdir(), "ingombro-test-")), "app")
const TestLayer = makeCoreLayer(AppPaths.layerAt(appDir)).pipe(Layer.provideMerge(SilentLogger))
const run = <A, E>(effect: Effect.Effect<A, E, CoreServices>) =>
  Effect.runPromise(Effect.provide(effect, TestLayer))

test("settings default", async () => {
  const s = await run(Settings.use((s) => s.get))
  expect(s.deleteMode).toBe("trash")
})
```

- Point data files at a temp dir with `AppPaths.layerAt(dir)` instead of touching `~/.ingombro`.
- Expected failures: `effect.pipe(Effect.flip)` then assert on `_tag`.
- Cancellation: `Effect.forkChild(work)`, `Fiber.interrupt(fiber)`, then `Exit.hasInterrupts(yield* Fiber.await(fiber))`.
- Prefer real temp directories over FileSystem mocks: the scanner uses sync `fs` directly.
- Use `Settings.save({ ..., deleteMode: "permanent" })` before exercising deletes, otherwise files go to the real Trash.
