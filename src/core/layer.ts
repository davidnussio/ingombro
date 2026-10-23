import { BunChildProcessSpawner, BunFileSystem, BunPath } from "@effect/platform-bun";
import { type FileSystem, Layer, type Path } from "effect";
import { Envsec, FileActions, Trash } from "./actions";
import { CacheStore } from "./cache";
import { Cleanables } from "./cleanables";
import { EntryInfoReader } from "./entry-info";
import { AppPaths } from "./paths";
import { Scanner } from "./scanner";
import { Settings } from "./settings";
import { Stats } from "./stats";

export type CoreServices =
	| AppPaths
	| Settings
	| CacheStore
	| Stats
	| Scanner
	| Cleanables
	| EntryInfoReader
	| Trash
	| FileActions
	| Envsec;

/**
 * Only the platform services the core uses. Not BunServices: its Terminal/Stdio attach to
 * process.stdin, which has no business in the Electrobun Worker that runs the desktop app.
 */
const PlatformLayer = BunChildProcessSpawner.layer.pipe(Layer.provideMerge(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)));

/** Every core service, built on the given AppPaths (Bun platform services included). */
export const makeCoreLayer = (paths: Layer.Layer<AppPaths, never, FileSystem.FileSystem | Path.Path>) => {
	const base = Layer.mergeAll(paths, Scanner.layer);
	const settings = Settings.layer.pipe(Layer.provideMerge(base));
	const cache = CacheStore.layer.pipe(Layer.provideMerge(settings));
	const trash = Trash.layer;
	const actions = Layer.mergeAll(FileActions.layer.pipe(Layer.provideMerge(trash)), Envsec.layer);
	return Layer.mergeAll(actions, Stats.layer, Cleanables.layer, EntryInfoReader.layer).pipe(
		Layer.provideMerge(cache),
		Layer.provide(PlatformLayer),
	);
};

/** Core services on the real data directory (~/.ingombro or INGOMBRO_HOME). */
export const CoreLayer: Layer.Layer<CoreServices> = makeCoreLayer(AppPaths.layer);
