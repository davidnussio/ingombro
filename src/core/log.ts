// Core modules log through this indirection: the desktop app keeps console output,
// the TUI silences it (stdout belongs to the renderer).
export interface Logger {
	log: (...args: unknown[]) => void;
	error: (...args: unknown[]) => void;
}

export let logger: Logger = console;

export function setLogger(l: Logger) {
	logger = l;
}

export const silentLogger: Logger = { log: () => {}, error: () => {} };
