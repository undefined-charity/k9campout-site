import node from "@astrojs/node";
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import { defineConfig } from "astro/config";
import emdash, { local } from "emdash/astro";
import { sqlite } from "emdash/db";
import { d1, r2 } from "@emdash-cms/cloudflare";
import postal from "emdash-postal";

// EMDASH_TARGET=cloudflare → Workers build (D1 + R2, deployed via wrangler).
// Default → Node build (SQLite + local uploads) for `npm run dev` and Docker.
const isCloudflare = process.env.EMDASH_TARGET === "cloudflare";

export default defineConfig({
	output: "server",
	adapter: isCloudflare ? cloudflare() : node({ mode: "standalone" }),
	image: {
		layout: "constrained",
		responsiveStyles: true,
	},
	integrations: [
		react(),
		emdash({
			// Postal email transport (invites, magic links) — configure the
			// server URL/credential in the admin UI under Settings → Postal.
			plugins: [postal()],
			...(isCloudflare
				? {
						database: d1({ binding: "DB", session: "auto" }),
						storage: r2({ binding: "MEDIA" }),
					}
				: {
						database: sqlite({ url: process.env.DATABASE_PATH ?? "file:./data.db" }),
						storage: local({
							directory: process.env.UPLOADS_DIR ?? "./uploads",
							baseUrl: "/_emdash/api/media/file",
						}),
					}),
		}),
	],
	devToolbar: { enabled: false },
});
