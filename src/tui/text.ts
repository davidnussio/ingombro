import { StyledText, type TextChunk, bg, bold as boldFn, dim as dimFn, fg } from "@opentui/core";

export interface Style {
	fg?: string;
	bg?: string;
	bold?: boolean;
	dim?: boolean;
}

export type Seg = [text: string, style?: Style];
export type Line = Seg[];

const width = (s: string) => Bun.stringWidth(s);

/** Remove control characters and expand tabs so text never breaks the layout. */
export function sanitize(s: string): string {
	return s.replace(/\t/g, "  ").replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
}

/** Truncate to `w` columns (with …), never pad. */
export function truncate(s: string, w: number): string {
	if (w <= 0) return "";
	if (width(s) <= w) return s;
	let out = "";
	let cur = 0;
	for (const ch of s) {
		const cw = width(ch);
		if (cur + cw > w - 1) break;
		out += ch;
		cur += cw;
	}
	return out + "…";
}

/** Truncate keeping the end visible (useful for paths). */
export function truncateLeft(s: string, w: number): string {
	if (w <= 0) return "";
	if (width(s) <= w) return s;
	const chars = [...s];
	let out = "";
	let cur = 0;
	for (let i = chars.length - 1; i >= 0; i--) {
		const cw = width(chars[i]!);
		if (cur + cw > w - 1) break;
		out = chars[i] + out;
		cur += cw;
	}
	return "…" + out;
}

export function padRight(s: string, w: number): string {
	const t = truncate(s, w);
	return t + " ".repeat(Math.max(0, w - width(t)));
}

export function padLeft(s: string, w: number): string {
	const t = truncate(s, w);
	return " ".repeat(Math.max(0, w - width(t))) + t;
}

export function lineWidth(line: Line): number {
	return line.reduce((n, [t]) => n + width(t), 0);
}

/** Fit a line exactly to `w` columns: truncate trailing segments and pad, optionally with a row bg. */
export function fitLine(line: Line, w: number, rowBg?: string): Line {
	const out: Line = [];
	let used = 0;
	for (const [text, style] of line) {
		if (used >= w) break;
		const room = w - used;
		const t = width(text) > room ? truncate(text, room) : text;
		out.push([t, rowBg ? { ...style, bg: style?.bg ?? rowBg } : style]);
		used += width(t);
	}
	if (used < w) out.push([" ".repeat(w - used), rowBg ? { bg: rowBg } : undefined]);
	return out;
}

function toChunk([text, style]: Seg): TextChunk {
	let c: TextChunk = fg(style?.fg ?? "#d7dae0")(text);
	if (style?.bg) c = bg(style.bg)(c);
	if (style?.bold) c = boldFn(c);
	if (style?.dim) c = dimFn(c);
	return c;
}

export function toStyled(lines: Line[]): StyledText {
	const chunks: TextChunk[] = [];
	lines.forEach((line, i) => {
		if (i > 0) chunks.push(fg("#000000")("\n"));
		for (const seg of line) if (seg[0]) chunks.push(toChunk(seg));
	});
	return new StyledText(chunks);
}

/** Proportional bar using 1/8 block characters. */
export function bar(ratio: number, w: number): { filled: string; empty: string } {
	const r = Math.max(0, Math.min(1, ratio));
	const eighths = Math.round(r * w * 8);
	const full = Math.floor(eighths / 8);
	const rest = eighths % 8;
	const parts = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"];
	let filled = "█".repeat(full) + (rest ? parts[rest] : "");
	if (r > 0 && filled === "") filled = "▏";
	const empty = "·".repeat(Math.max(0, w - width(filled)));
	return { filled, empty };
}

/** Keep the cursor visible: returns the new scroll offset. */
export function clampScroll(cursor: number, scroll: number, height: number, count: number): number {
	if (height <= 0) return 0;
	if (cursor < scroll) scroll = cursor;
	if (cursor >= scroll + height) scroll = cursor - height + 1;
	return Math.max(0, Math.min(scroll, Math.max(0, count - height)));
}
