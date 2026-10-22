#!/usr/bin/env bun
// Ingombro TUI: lazygit-style terminal interface for the Ingombro disk analyzer.
import { createCliRenderer } from "@opentui/core";
import { setLogger, silentLogger } from "../core";
import { App } from "./app";
import { theme } from "./theme";
import pkg from "../../package.json";

const HELP = `ingombro ${pkg.version}: analyze disk space and clean up bloated folders

Usage:
  ingombro [path] [options]

Arguments:
  path             Folder to analyze. If it was scanned before, the cached
                   result opens instantly (use --rescan to scan again).
                   Without a path, the most recent scan is opened.

Options:
  -r, --rescan     Ignore the cache and scan again
  -h, --help       Show this help
  -v, --version    Show version

Data (cache, settings, stats) is shared with the desktop app in ~/.ingombro.
Press ? inside the app for keybindings.`;

const args = process.argv.slice(2);
if (args.includes("-h") || args.includes("--help")) {
	console.log(HELP);
	process.exit(0);
}
if (args.includes("-v") || args.includes("--version")) {
	console.log(pkg.version);
	process.exit(0);
}
const rescan = args.includes("-r") || args.includes("--rescan");
const unknown = args.find((a) => a.startsWith("-") && !["-r", "--rescan"].includes(a));
if (unknown) {
	console.error(`Unknown option: ${unknown}\n\n${HELP}`);
	process.exit(2);
}
const initialPath = args.find((a) => !a.startsWith("-"));

// stdout belongs to the renderer: silence core logging
setLogger(silentLogger);

const renderer = await createCliRenderer({
	exitOnCtrlC: false,
	useMouse: false,
	backgroundColor: theme.bg,
	targetFps: 30,
});

const app = new App(renderer, {
	initialPath,
	rescan,
	onExit: async () => {
		await renderer.closed;
		process.exit(0);
	},
});
await app.start();
