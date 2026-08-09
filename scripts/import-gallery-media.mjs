// Import gallery photos into the EmDash media library and (re)build the
// native Portable Text gallery blocks on each gallery page.
//
// Idempotent: photos already in the media library (matched by filename+size)
// are reused, and existing gallery blocks are replaced in place. Run it
// against local dev after a reseed, or against production once after the
// first deploy:
//
//   node scripts/import-gallery-media.mjs                        # local dev
//   node scripts/import-gallery-media.mjs --url https://k9campout.com
//
// Remote instances need auth first: `npx emdash login --url https://...`.
// Photo originals live in source-assets/gallery/ (not deployed); the media
// library copy is what the site serves, so deleting a photo in the admin
// Media section genuinely removes it from the site.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/gallery-manifest.json"), "utf8"));

const urlArg = process.argv.indexOf("--url");
const BASE_URL = urlArg !== -1 ? process.argv[urlArg + 1] : "http://localhost:4321";

function emdash(args, input) {
	const out = execFileSync("npx", ["emdash", ...args, "--url", BASE_URL, "--json"], {
		cwd: ROOT,
		encoding: "utf8",
		input,
		maxBuffer: 64 * 1024 * 1024,
		stdio: ["pipe", "pipe", "pipe"],
	});
	// CLI may print info lines before the JSON payload
	const start = out.search(/[[{]/);
	return JSON.parse(out.slice(start));
}

let key = 0;
const nextKey = (prefix) => `${prefix}-${(key++).toString(36)}`;

// ---------------------------------------------------------------------------
// 1. Media: upload anything the library doesn't already have
// ---------------------------------------------------------------------------

const existing = new Map(); // "filename:size" -> media record
let cursor;
do {
	const page = emdash(["media", "list", "--limit", "100", ...(cursor ? ["--cursor", cursor] : [])]);
	const items = page.items ?? page;
	for (const m of items) existing.set(`${m.filename}:${m.size}`, m);
	cursor = page.nextCursor || undefined;
} while (cursor);
console.log(`media library: ${existing.size} existing items`);

let uploaded = 0;
for (const entry of MANIFEST) {
	for (const img of entry.images) {
		const file = path.join(ROOT, img.file);
		const size = fs.statSync(file).size;
		const mapKey = `${path.basename(file)}:${size}`;
		if (existing.has(mapKey)) continue;
		const media = emdash(["media", "upload", file, ...(img.alt ? ["--alt", img.alt] : [])]);
		existing.set(mapKey, media);
		uploaded++;
		console.log(`  uploaded ${path.basename(file)} -> ${media.id}`);
	}
}
console.log(`uploaded ${uploaded} new photos`);

// ---------------------------------------------------------------------------
// 2. Pages: replace/insert the gallery block in each gallery page's content
// ---------------------------------------------------------------------------

for (const entry of MANIFEST) {
	const galleryBlock = {
		_type: "gallery",
		_key: nextKey(`gallery-${entry.page}`),
		columns: entry.columns ?? 2,
		images: entry.images.map((img) => {
			const file = path.join(ROOT, img.file);
			const media = existing.get(`${path.basename(file)}:${fs.statSync(file).size}`);
			if (!media) throw new Error(`media missing for ${img.file}`);
			return {
				_type: "image",
				_key: nextKey("img"),
				asset: { _ref: media.id, url: media.url },
				alt: img.alt || undefined,
				width: media.width || undefined,
				height: media.height || undefined,
				blurhash: media.blurhash || undefined,
				dominantColor: media.dominantColor || undefined,
			};
		}),
	};

	const page = emdash(["content", "get", "pages", entry.page, "--raw"]);
	const existing_content = Array.isArray(page.data.content) ? page.data.content : [];

	// Drop any previous gallery blocks, then insert the rebuilt one directly
	// after the first h2 heading (the "2025" / "2026" year heading) — matching
	// where the Jekyll gallery include sat. Fallback: append at the end.
	const content = existing_content.filter((b) => b._type !== "gallery");
	const h2Idx = content.findIndex((b) => b._type === "block" && b.style === "h2");
	content.splice(h2Idx === -1 ? content.length : h2Idx + 1, 0, galleryBlock);

	const payload = JSON.stringify({ content });
	emdash(["content", "update", "pages", page.id, "--rev", page._rev, "--stdin"], payload);
	console.log(`updated ${entry.page}: gallery block with ${galleryBlock.images.length} photos`);
}

console.log("done");
