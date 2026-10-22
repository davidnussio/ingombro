/** Human-readable byte size, base 1024 like the desktop app. */
export function formatSize(bytes: number): string {
	if (bytes <= 0) return "0 B";
	const units = ["B", "KB", "MB", "GB", "TB", "PB"];
	const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
	const val = bytes / Math.pow(1024, i);
	return `${i === 0 ? val.toFixed(0) : val.toFixed(1)} ${units[i]}`;
}

export function formatAgo(ts: number, now = Date.now()): string {
	const s = Math.max(0, Math.round((now - ts) / 1000));
	if (s < 60) return `${s}s ago`;
	const m = Math.round(s / 60);
	if (m < 60) return `${m}m ago`;
	const h = Math.round(m / 60);
	if (h < 48) return `${h}h ago`;
	const d = Math.round(h / 24);
	if (d < 60) return `${d}d ago`;
	return `${Math.round(d / 30)}mo ago`;
}

export function formatDate(ts: number): string {
	if (!ts) return "-";
	const d = new Date(ts);
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
