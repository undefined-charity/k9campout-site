import type { APIRoute } from "astro";
import { getEmDashCollection } from "emdash";
import { ptText, postUrl } from "../utils/posts";

const SITE_URL = "https://k9campout.com";
const SITE_TITLE = "K9 Campout";

function escapeXml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

export const GET: APIRoute = async () => {
	const { entries: posts } = await getEmDashCollection("posts", {
		orderBy: { date: "desc" },
		limit: 10,
	});

	const items = posts
		.map((post) => {
			const url = `${SITE_URL}${postUrl(post)}`;
			const date = post.data.date ? new Date(post.data.date).toISOString() : new Date().toISOString();
			const excerpt = post.data.excerpt ?? ptText(post.data.content).slice(0, 300);
			return `  <entry>
    <title type="html">${escapeXml(post.data.title)}</title>
    <link href="${url}" rel="alternate" type="text/html" title="${escapeXml(post.data.title)}" />
    <published>${date}</published>
    <updated>${date}</updated>
    <id>${url}</id>
    <author><name>undefined.charity</name></author>
    <summary type="html">${escapeXml(excerpt)}</summary>
  </entry>`;
		})
		.join("\n");

	return new Response(
		`<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en-US">
  <generator uri="https://emdashcms.com/">EmDash</generator>
  <link href="${SITE_URL}/feed.xml" rel="self" type="application/atom+xml" />
  <link href="${SITE_URL}/" rel="alternate" type="text/html" />
  <updated>${new Date().toISOString()}</updated>
  <id>${SITE_URL}/feed.xml</id>
  <title type="html">${SITE_TITLE}</title>
  <subtitle>K9 Campout - A community camping event for pups and handlers, operated by Undefined</subtitle>
${items}
</feed>`,
		{
			headers: {
				"Content-Type": "application/atom+xml; charset=utf-8",
				"Cache-Control": "public, max-age=3600",
			},
		},
	);
};
