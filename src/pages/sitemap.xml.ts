import type { APIRoute } from "astro";
import { getEmDashCollection } from "emdash";
import { postUrl } from "../utils/posts";

const SITE_URL = "https://k9campout.com";

export const GET: APIRoute = async () => {
	const [{ entries: posts }, { entries: pages }] = await Promise.all([
		getEmDashCollection("posts", { orderBy: { date: "desc" }, limit: 500 }),
		getEmDashCollection("pages", { limit: 500 }),
	]);

	const urls: string[] = ["/", "/posts/", "/categories/", "/tags/"];

	for (const page of pages) {
		// Year pages use "2025-schedule" style slugs → /2025/schedule.
		const m = page.id.match(/^(20\d{2})-(.+)$/);
		if (page.id === "home") continue;
		urls.push(m ? `/${m[1]}/${m[2]}` : `/${page.id}`);
	}
	for (const post of posts) {
		urls.push(`${postUrl(post)}`);
	}

	const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${SITE_URL}${u}</loc></url>`).join("\n")}
</urlset>`;

	return new Response(body, {
		headers: {
			"Content-Type": "application/xml; charset=utf-8",
			"Cache-Control": "public, max-age=3600",
		},
	});
};
