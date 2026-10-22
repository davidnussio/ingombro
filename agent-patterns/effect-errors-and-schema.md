# Effect 4: errors and Schema

Sources: `repos/effect/LLMS.md` ("Error handling", "Defining schemas"), `repos/effect/ai-docs/src/01_effect/04_errors/`, `repos/effect/packages/effect/src/Schema.ts`, `repos/effect/packages/effect/SCHEMA.md` (large, read in chunks).

## Tagged errors

```ts
export class DeleteError extends Schema.TaggedError<DeleteError>()("DeleteError", {
  path: Schema.String,
  cause: Schema.Defect(),            // wraps an unknown thrown value / PlatformError
}) {
  override get message() { return causeMessage(this.cause) }   // `override` is required
}
```

- Fail: `return yield* new DeleteError({ path, cause })` (always `return`, so TS knows control stops).
- Wrap promises: `Effect.tryPromise({ try, catch: (cause) => new XError({ cause }) })`; sync code: `Effect.try(...)`.
- Recover: `Effect.catchTag("Tag", ...)`, several: `Effect.catchTag(["A", "B"], ...)`, everything: `Effect.catch`. Inspect without recovering: `Effect.tapError`.
- Keep going per item and collect failures: `Effect.result` → `Result` with `_tag: "Success" | "Failure"` (see `FileActions.batchDelete`).
- Fallbacks: `Effect.orElseSucceed(() => x)`, `Effect.option`, `Effect.ignore`. v3's `Effect.orElse` / `catchAll` do not exist.
- Project errors live in `src/core/errors.ts`. Never throw from service code.

## Schema models

Types derive from schemas; persisted data is decoded, never cast.

```ts
export const AppSettings = Schema.Struct({
  maxCacheEntries: Schema.Number,
  deleteMode: Schema.Literals(["trash", "permanent"]),   // v3 Schema.Literal(...many) → Literals([...])
  maxDepth: Schema.Number,
})
export interface AppSettings extends Schema.Schema.Type<typeof AppSettings> {}
```

- Optional key: `Schema.optional(S)`; arrays: `Schema.Array(S)` (readonly in the type).
- Recursive: declare the interface by hand and `Schema.suspend((): Schema.Codec<T> => T)` (see `DirEntry`).
- Default when a key is missing on disk: `S.pipe(Schema.withDecodingDefaultKey(Effect.succeed(value)))` (see `SettingsFile`).
- JSON text: `Schema.fromJsonString(S, { space: 2 })` encodes pretty JSON and decodes text in one step.
- Run: `Schema.decodeUnknownEffect(S)(input)`, `Schema.encodeEffect(S)(value)`; sync variants exist for boundaries.
- Runtime checks: use `Predicate` (`Predicate.hasProperty`, `isString`, ...) instead of hand-written guards.

Decoding is cheap: a 270k-node scan tree decodes in about the same time as `JSON.parse`.

Because schema types are readonly, data updates are immutable: copy the changed branch (`removeFromTree`) instead of mutating.
