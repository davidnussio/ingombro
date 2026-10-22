# Effect 4: platform (Bun), processes, logging, CLI

Sources: `repos/effect/packages/effect/src/{FileSystem,Path,Logger,Config,DateTime}.ts`, `repos/effect/packages/effect/src/process/`, `repos/effect/packages/effect/src/cli/`, `repos/effect/packages/platform/bun/src/`, `repos/effect/ai-docs/src/{60_child-process,70_cli,08_observability}/`.

In v4 the platform *interfaces* live in `effect` itself (`effect/FileSystem`, `effect/Path`, `effect/process`, `effect/cli`); `@effect/platform-bun` only provides implementations. `BunServices.layer` provides FileSystem, Path, ChildProcessSpawner, Crypto, Stdio, Terminal.

## FileSystem

```ts
const fs = yield* FileSystem.FileSystem
const text = yield* fs.readFileString(path)          // fails with PlatformError
yield* fs.writeFileString(path, text)
yield* fs.makeDirectory(dir, { recursive: true })
const info = yield* fs.stat(path)                    // info.type: "File" | "Directory" | ...
const blocks = Option.getOrElse(info.blocks, () => 0n) // many stat fields are Option, sizes bigint
```

- `readDirectory` returns names only (no types): stat each entry if needed.
- Partial reads: `Effect.scoped(fs.open(path).pipe(Effect.flatMap((f) => f.readAlloc(n))))`.
- Hot paths: the scanner and Smart Clean walk directories with sync `fs` calls **one `Effect.sync` per directory**. Per-entry async stats are several times slower; per-directory steps keep scans interruptible and let the UI breathe. Keep that granularity when touching `src/core/scanner.ts` / `cleanables.ts`.

## Child processes

```ts
const spawner = yield* ChildProcessSpawner.ChildProcessSpawner   // from "effect/process"
const code = yield* spawner.exitCode(ChildProcess.make("open", ["-R", path]))
// spawner.string(cmd) / spawner.lines(cmd) collect output
```

Non-zero exit is not a failure by itself: check the code (`Effect.filterOrFail((c) => c === 0)`).

## Config, time, logging

- `Config.String("INGOMBRO_HOME").pipe(Config.withDefault(x))` is yieldable inside `Effect.gen`.
- Time: `DateTime.now`, `DateTime.formatIsoDateUtc`, `DateTime.subtract(dt, { days })`, `Clock.currentTimeMillis`; `Effect.timed` returns `[Duration, A]`.
- Logging: `Effect.log`, `Effect.logError`, `Effect.logDebug`. Replace loggers with `Logger.layer([...])`; `Logger.layer([])` silences everything (the TUI's `SilentLogger`, since the renderer owns stdout).

## CLI (`effect/cli`)

```ts
const cmd = Command.make("ingombro", {
  path: Argument.String("path").pipe(Argument.optional),                  // Option<string>
  rescan: Flag.Boolean("rescan").pipe(Flag.withAlias("r"), Flag.withDefault(false)),
}, Effect.fn("ingombro")(function* ({ path, rescan }) { /* ... */ }))

cmd.pipe(Command.run({ version }), Effect.provide(BunServices.layer), BunRuntime.runMain)
```

- Boolean flags are **required unless given `Flag.withDefault(false)`**.
- `--help`, `--version` (`-v`), `--completions`, `--log-level` come built in; `--version` prints `<name> v<version>`.
- `runMain` exits on its own only on failure or signal. For a TUI that leaves stdin handles open, pass a `teardown` that calls `process.exit(code)` (see `src/tui/main.ts`).
