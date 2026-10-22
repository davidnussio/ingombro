import { mkdirSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";

/** Resolve `~`, make absolute and strip the trailing slash (except for "/"). */
export function expandPath(p: string): string {
	let result: string;
	if (p.startsWith("~/")) result = join(homedir(), p.slice(2));
	else if (p === "~") result = homedir();
	else result = resolve(p);
	if (result.length > 1 && result.endsWith("/")) result = result.slice(0, -1);
	return result;
}

/** Inverse of expandPath for display: /Users/me/x -> ~/x */
export function prettyPath(p: string): string {
	const home = homedir();
	if (p === home) return "~";
	if (p.startsWith(home + "/")) return "~" + p.slice(home.length);
	return p;
}

/** Data directory, overridable for tests with INGOMBRO_HOME. */
export const APP_DIR = process.env.INGOMBRO_HOME || join(homedir(), ".ingombro");

export function ensureAppDir() {
	mkdirSync(APP_DIR, { recursive: true });
}
