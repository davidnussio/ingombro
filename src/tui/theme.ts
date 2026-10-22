export const theme = {
	bg: "#16181d",
	border: "#4b5263",
	borderFocus: "#7ee787",
	title: "#abb2bf",
	titleFocus: "#7ee787",
	text: "#d7dae0",
	dim: "#7f848e",
	dir: "#61afef",
	file: "#d7dae0",
	size: "#e5c07b",
	selBg: "#2c4a63",
	selBgBlur: "#2c313a",
	mark: "#c678dd",
	ok: "#98c379",
	warn: "#e5c07b",
	err: "#e06c75",
	info: "#56b6c2",
	barEmpty: "#3a3f4b",
	modalBg: "#1e2128",
	risk: { low: "#98c379", medium: "#e5c07b", high: "#e06c75" } as Record<string, string>,
	category: {
		dev: "#61afef",
		ml: "#c678dd",
		office: "#abb2bf",
		design: "#e06c75",
		video: "#d19a66",
		music: "#56b6c2",
		secrets: "#e5c07b",
	} as Record<string, string>,
};

/** Bar color by share of the parent. */
export function barColor(ratio: number): string {
	if (ratio >= 0.5) return theme.err;
	if (ratio >= 0.2) return theme.warn;
	return theme.ok;
}
