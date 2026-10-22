import { homedir } from "os";
import { basename, join } from "path";
import { Context, Effect, FileSystem, Layer } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { CacheStore } from "./cache";
import { CommandError, DeleteError, EnvsecError, PathNotFound, causeMessage } from "./errors";
import { expandPath } from "./paths";
import { Scanner } from "./scanner";
import { Settings } from "./settings";
import type { DeleteMode } from "./types";

// ─── Trash ──────────────────────────────────────────────────────────────────

/**
 * Move to the Trash. macOS: Finder first (keeps "Put Back"), then a plain move into ~/.Trash.
 * Linux: freedesktop Trash. Never falls back to a permanent delete: if nothing works it fails.
 */
export class Trash extends Context.Service<
	Trash,
	{
		moveToTrash(resolved: string): Effect.Effect<void, DeleteError>;
	}
>()("ingombro/core/Trash") {
	static readonly layer = Layer.effect(
		Trash,
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

			/** Pick a name that doesn't clash inside `dir`. */
			const uniqueTarget = Effect.fnUntraced(function* (dir: string, name: string) {
				let target = join(dir, name);
				for (let i = 2; yield* fs.exists(target); i++) target = join(dir, `${name} ${i}`);
				return target;
			});

			const viaFinder = (resolved: string) => {
				const escaped = resolved.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
				return spawner
					.exitCode(ChildProcess.make("osascript", ["-e", `tell application "Finder" to delete POSIX file "${escaped}"`]))
					.pipe(Effect.filterOrFail((code) => code === 0));
			};

			const darwin = (resolved: string) =>
				viaFinder(resolved).pipe(
					Effect.catch(() =>
						Effect.gen(function* () {
							const target = yield* uniqueTarget(join(homedir(), ".Trash"), basename(resolved));
							yield* fs.rename(resolved, target);
						}),
					),
				);

			const freedesktop = Effect.fnUntraced(function* (resolved: string) {
				const trashRoot = join(process.env.XDG_DATA_HOME || join(homedir(), ".local/share"), "Trash");
				const filesDir = join(trashRoot, "files");
				const infoDir = join(trashRoot, "info");
				yield* fs.makeDirectory(filesDir, { recursive: true });
				yield* fs.makeDirectory(infoDir, { recursive: true });
				const target = yield* uniqueTarget(filesDir, basename(resolved));
				yield* fs.rename(resolved, target);
				const deletionDate = new Date().toISOString().slice(0, 19);
				yield* fs.writeFileString(
					join(infoDir, basename(target) + ".trashinfo"),
					`[Trash Info]\nPath=${encodeURI(resolved)}\nDeletionDate=${deletionDate}\n`,
				);
			});

			const moveToTrash = (resolved: string) =>
				(process.platform === "darwin" ? darwin(resolved) : freedesktop(resolved)).pipe(
					Effect.mapError((cause) => new DeleteError({ path: resolved, cause })),
					Effect.withSpan("Trash.moveToTrash"),
				);

			return Trash.of({ moveToTrash });
		}),
	);
}

// ─── File actions ───────────────────────────────────────────────────────────

export interface BatchDeleteResult {
	readonly success: boolean;
	readonly deletedCount: number;
	readonly deletedSize: number;
	readonly deletedPaths: ReadonlyArray<string>;
	readonly errors: ReadonlyArray<string>;
}

export interface BatchDeleteOptions {
	/** Avoids re-walking directories whose size the caller already knows. */
	readonly knownSizes?: ReadonlyMap<string, number>;
	readonly onItem?: (path: string, index: number) => Effect.Effect<void>;
}

export class FileActions extends Context.Service<
	FileActions,
	{
		remove(resolved: string, mode: DeleteMode): Effect.Effect<void, DeleteError>;
		/** Delete paths (trash or permanent per settings) and prune them from every cached tree. */
		batchDelete(paths: ReadonlyArray<string>, options?: BatchDeleteOptions): Effect.Effect<BatchDeleteResult>;
		/** Directory suggestions for path autocomplete (max 20, "~"-prefixed when under home). */
		listDirSuggestions(partial: string): Effect.Effect<ReadonlyArray<string>>;
		isDirectory(path: string): Effect.Effect<boolean>;
		/** Reveal in Finder (file) or open (directory). macOS: `open`, Linux: `xdg-open`. */
		reveal(path: string): Effect.Effect<void, PathNotFound | CommandError>;
	}
>()("ingombro/core/FileActions") {
	static readonly layer = Layer.effect(
		FileActions,
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
			const trash = yield* Trash;
			const settings = yield* Settings;
			const cache = yield* CacheStore;
			const scanner = yield* Scanner;

			const isDirectory = (path: string) =>
				fs.stat(expandPath(path)).pipe(
					Effect.map((info) => info.type === "Directory"),
					Effect.orElseSucceed(() => false),
				);

			const remove = (resolved: string, mode: DeleteMode) =>
				mode === "trash"
					? trash.moveToTrash(resolved)
					: fs
							.remove(resolved, { recursive: true, force: true })
							.pipe(Effect.mapError((cause) => new DeleteError({ path: resolved, cause })));

			const batchDelete = Effect.fn("FileActions.batchDelete")(function* (
				paths: ReadonlyArray<string>,
				options: BatchDeleteOptions = {},
			) {
				const { deleteMode } = yield* settings.get;
				let deletedSize = 0;
				const deletedPaths: string[] = [];
				const errors: string[] = [];

				for (const [i, p] of paths.entries()) {
					if (options.onItem) yield* options.onItem(p, i);
					const resolved = expandPath(p);
					const outcome = yield* Effect.gen(function* () {
						if (!(yield* fs.exists(resolved).pipe(Effect.orElseSucceed(() => false)))) {
							return yield* new PathNotFound({ path: p });
						}
						const size = options.knownSizes?.get(p) ?? (yield* scanner.pathSize(resolved));
						yield* remove(resolved, deleteMode);
						return size;
					}).pipe(Effect.result);
					if (outcome._tag === "Success") {
						deletedSize += outcome.success;
						deletedPaths.push(resolved);
					} else {
						errors.push(outcome.failure._tag === "PathNotFound" ? outcome.failure.message : `${p}: ${outcome.failure.message}`);
					}
				}

				if (deletedPaths.length > 0) yield* cache.pruneDeleted(deletedPaths);
				return {
					success: errors.length === 0,
					deletedCount: deletedPaths.length,
					deletedSize,
					deletedPaths,
					errors,
				};
			});

			const listDirSuggestions = (partial: string) =>
				Effect.gen(function* () {
					const input = partial || "~";
					const expanded = expandPath(input);
					let dirToList = expanded;
					let prefix = "";
					if (!input.endsWith("/") && !(yield* isDirectory(expanded))) {
						dirToList = join(expanded, "..");
						prefix = basename(expanded).toLowerCase();
					}
					if (!(yield* isDirectory(dirToList))) return [];

					const home = homedir();
					const names = (yield* fs.readDirectory(dirToList))
						.filter((name) => !name.startsWith(".") && (!prefix || name.toLowerCase().startsWith(prefix)))
						.sort();
					const suggestions: string[] = [];
					for (const name of names) {
						const fullPath = join(dirToList, name);
						if (!(yield* isDirectory(fullPath))) continue;
						suggestions.push(fullPath.startsWith(home) ? "~" + fullPath.slice(home.length) : fullPath);
						if (suggestions.length >= 20) break;
					}
					return suggestions.sort();
				}).pipe(
					Effect.catch((e) => Effect.logError("[ingombro] listDir error:", e).pipe(Effect.as([]))),
					Effect.withSpan("FileActions.listDirSuggestions"),
				);

			const reveal = Effect.fn("FileActions.reveal")(function* (path: string) {
				const resolved = expandPath(path);
				const info = yield* fs.stat(resolved).pipe(Effect.mapError(() => new PathNotFound({ path: resolved })));
				const isDir = info.type === "Directory";
				const command =
					process.platform === "darwin"
						? ChildProcess.make("open", isDir ? [resolved] : ["-R", resolved])
						: ChildProcess.make("xdg-open", [isDir ? resolved : join(resolved, "..")]);
				yield* spawner.exitCode(command).pipe(
					Effect.filterOrFail((code) => code === 0),
					Effect.mapError((cause) => new CommandError({ command: command.command, cause })),
				);
			});

			return FileActions.of({ remove, batchDelete, listDirSuggestions, isDirectory, reveal });
		}),
	);
}

// ─── envsec integration ─────────────────────────────────────────────────────

export function parseEnvFile(content: string): [string, string][] {
	const entries: [string, string][] = [];
	for (const line of content.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const eqIdx = trimmed.indexOf("=");
		if (eqIdx < 1) continue;
		const key = trimmed.slice(0, eqIdx).trim();
		let value = trimmed.slice(eqIdx + 1).trim();
		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1);
		}
		if (key && value) entries.push([key, value]);
	}
	return entries;
}

type EnvsecClient = Awaited<ReturnType<(typeof import("@envsec/sdk"))["EnvsecClient"]["create"]>>;

/** Moves secrets out of .env files into the envsec keychain store. */
export class Envsec extends Context.Service<
	Envsec,
	{
		readonly isAvailable: Effect.Effect<boolean>;
		/** Import a .env file into an envsec context, then delete the file and prune the cache. Returns the count. */
		importEnvFile(filePath: string, context: string): Effect.Effect<number, EnvsecError>;
	}
>()("ingombro/core/Envsec") {
	static readonly layer = Layer.effect(
		Envsec,
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const cache = yield* CacheStore;

			// The SDK is loaded lazily: it pulls in native keychain bindings.
			const client = (context: string) =>
				Effect.acquireRelease(
					Effect.tryPromise({
						try: async () => (await import("@envsec/sdk")).EnvsecClient.create({ context }),
						catch: (cause) => new EnvsecError({ reason: "envsec unavailable", cause }),
					}),
					(c: EnvsecClient) => Effect.promise(() => c.close()).pipe(Effect.ignore),
				);

			const isAvailable = Effect.scoped(client("__envsec_check__")).pipe(
				Effect.as(true),
				Effect.orElseSucceed(() => false),
				Effect.withSpan("Envsec.isAvailable"),
			);

			const importEnvFile = Effect.fn("Envsec.importEnvFile")(
				function* (filePath: string, context: string) {
					const resolved = expandPath(filePath);
					const content = yield* fs
						.readFileString(resolved)
						.pipe(Effect.mapError((cause) => new EnvsecError({ reason: "Cannot read file", cause })));
					const entries = parseEnvFile(content);
					if (entries.length === 0) return yield* new EnvsecError({ reason: "No valid entries found in file" });

					const imported = yield* Effect.scoped(
						Effect.gen(function* () {
							const c = yield* client(context);
							for (const [key, value] of entries) {
								yield* Effect.tryPromise({
									try: () => c.set(key, value),
									catch: (cause) => new EnvsecError({ reason: `Cannot store ${key}`, cause }),
								});
							}
							return entries.length;
						}),
					);

					yield* fs
						.remove(resolved, { force: true })
						.pipe(Effect.mapError((cause) => new EnvsecError({ reason: "Cannot delete file", cause })));
					yield* cache.pruneDeleted([resolved]);
					yield* Effect.log(`[envsec] Imported ${imported} secrets from ${resolved} to context "${context}"`);
					return imported;
				},
				Effect.tapError((e) => Effect.logError("[envsec] Import error:", causeMessage(e))),
			);

			return Envsec.of({ isAvailable, importEnvFile });
		}),
	);
}
