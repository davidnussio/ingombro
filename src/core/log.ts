import { Logger } from "effect";

/** No loggers at all: the TUI owns stdout, so core logging must stay quiet there. */
export const SilentLogger = Logger.layer([]);
