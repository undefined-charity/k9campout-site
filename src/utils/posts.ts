// Helpers shared by the post list/detail pages.

interface PTSpan {
	_type: string;
	text?: string;
}

interface PTBlock {
	_type: string;
	children?: PTSpan[];
}

/** Plain text of a Portable Text value (for word counts / excerpts). */
export function ptText(blocks: unknown): string {
	if (!Array.isArray(blocks)) return "";
	return (blocks as PTBlock[])
		.map((b) => (b.children ?? []).map((c) => c.text ?? "").join(""))
		.join("\n");
}

/** Minimal Mistakes read time: ceil(words / 200), minimum 1. */
export function readTime(blocks: unknown): string {
	const words = ptText(blocks).split(/\s+/).filter(Boolean).length;
	const minutes = Math.max(1, Math.ceil(words / 200));
	return `${minutes} minute read`;
}

/** Jekyll `truncate: 160` equivalent for archive excerpts. */
export function truncate(text: string, length = 160): string {
	if (text.length <= length) return text;
	return text.slice(0, length - 3).trimEnd() + "...";
}

/** URL of a post: original Jekyll permalink when recorded, else /updates/<slug>/. */
export function postUrl(post: { id: string; data: { permalink?: string | null } }): string {
	return post.data.permalink || `/updates/${post.id}/`;
}

/** MM long date, e.g. "August 4, 2026" (site timezone America/Los_Angeles). */
export function longDate(date: Date | null | undefined): string {
	if (!date) return "";
	return date.toLocaleDateString("en-US", {
		year: "numeric",
		month: "long",
		day: "numeric",
		timeZone: "America/Los_Angeles",
	});
}
