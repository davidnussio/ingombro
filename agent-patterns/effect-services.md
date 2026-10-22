# Effect 4: services, layers, running effects

Sources: `repos/effect/LLMS.md`, `repos/effect/ai-docs/src/01_effect/03_services/`, `repos/effect/ai-docs/src/04_integration/10_managed-runtime.ts`, `repos/effect/packages/effect/src/{Context,Layer,Effect,ManagedRuntime,FiberHandle,FiberMap}.ts`.

## Defining a service

`Context.Service` (v3's `Context.Tag` / `Effect.Service` are gone). Identifier = `"ingombro/<folder>/<Name>"`.

```ts
export class Stats extends Context.Service<Stats, {
  recordDeletion(freedBytes: number, deleteCount: number): Effect.Effect<void>
  summary(days: number): Effect.Effect<StatsSummary>
}>()("ingombro/core/Stats") {
  static readonly layer = Layer.effect(Stats, Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem      // dependencies are yielded once, at build time
    const summary = Effect.fn("Stats.summary")(function* (days: number) { /* ... */ })
    return Stats.of({ recordDeletion, summary })
  }))
}
```

- No dependencies: `Layer.succeed(Service, Service.of({...}))` (see `Scanner`).
- Need a variant (tests, other dirs): add a static factory, e.g. `AppPaths.layerAt(dir)`.
- Access in an effect: `const s = yield* Stats` or `Stats.use((s) => s.summary(30))`.
- Service type: `Stats["Service"]`.

## Functions

- `Effect.fn("Name.method")(function* (...) {...}, ...combinators)` for anything worth a span. Extra args after the generator replace `.pipe(...)`; **don't** `.pipe` an `Effect.fn`.
- `Effect.fnUntraced` for internal helpers and hot paths.
- Don't write functions that only `return Effect.gen(...)`; use `Effect.fn`.
- Inside a class, `Effect.gen({ self: this }, function* () { this.x })` binds `this` (used by the TUI `App`).

## Composing layers

`Layer.provide` hides the dependency, `Layer.provideMerge` also exposes it, `Layer.mergeAll` combines siblings. All core wiring is in `src/core/layer.ts` (`makeCoreLayer`, `CoreLayer`), on top of `BunServices.layer` from `@effect/platform-bun`.

## Running effects from non-Effect code

| Situation | Use |
| --- | --- |
| Process entry point | `BunRuntime.runMain(program)` (handles SIGINT/SIGTERM by interrupting) |
| Long-lived app built as a layer | `Layer.launch(AppLayer)` then `runMain` (`src/bun/index.ts`) |
| Callbacks inside an effect that already has the services | `const run = Effect.runPromiseWith(yield* Effect.context<R>())` (RPC handlers) |
| A class that needs to fork work (UI) | pass `Effect.context<R>()` in, then `Effect.runForkWith(context)` (`src/tui/app.ts`) |
| Browser/webview with no surrounding effect | `ManagedRuntime.make(layer)` and `runtime.runFork(...)` (`src/mainview/index.ts`) |

## Background work and cancellation

- Cancel = interrupt the fiber: `Fiber.interrupt(fiber)`; wait with `Fiber.await(fiber)` → `Exit`. `Cause.hasInterruptsOnly(exit.cause)` tells a cancel from a failure.
- One-at-a-time task (new one cancels the old): `FiberHandle.make()` + `FiberHandle.run(handle, effect)`; `FiberHandle.clear(handle)` cancels.
- Several named slots (debounces): `FiberMap.make()` + `FiberMap.run(map, key, Effect.andThen(Effect.sleep(ms), effect))`.
- Periodic: `Effect.repeat(effect, { schedule: Schedule.spaced("100 millis"), until: (done) => done })`.
- Delayed fire-and-forget inside a scope: `effect.pipe(Effect.delay("5 seconds"), Effect.forkScoped)`.
- Cleanup on cancel: `Effect.onInterrupt(() => ...)`, always-run: `Effect.ensuring(...)`.
