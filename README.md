# k9campout.com

The K9 Campout website -- an [EmDash](https://emdashcms.com) (Astro-based CMS)
site, migrated from Jekyll/Minimal Mistakes while keeping the original design.

## Develop

```bash
npm install
npx emdash dev
```

Site at http://localhost:4321, admin UI at http://localhost:4321/_emdash/admin.

A fresh checkout seeds the database (schema **and** all content) from
`seed/seed.json` automatically on first run; `npx emdash seed` applies it
manually to a fresh `data.db`.

## Deploy

Production target is **Cloudflare Workers** (D1 database + R2 media, see
`wrangler.jsonc`). CI (`.github/workflows/ci.yml`) deploys automatically on
push to `main`, and can test-deploy any branch via *Actions → CI → Run
workflow* with `deploy` checked.

One-time setup:

1. Add repository secrets `CLOUDFLARE_API_TOKEN` (Workers Scripts:Edit +
   D1:Edit + Workers R2 Storage:Edit permissions) and `CLOUDFLARE_ACCOUNT_ID`.
2. First deploy auto-provisions the `k9campout-emdash-db` D1 database and
   `k9campout-media` R2 bucket, and seeds all content from `seed/seed.json`
   on the first request.
3. Visit `/_emdash/admin` on the fresh deployment and claim the admin account
   (setup wizard / passkey) before sharing the URL.
4. Domain cutover: add the k9campout.com zone to the Cloudflare account, then
   uncomment the `routes` block in `wrangler.jsonc` and redeploy. Until then
   the site runs at `k9campout.<account>.workers.dev`.

Note: the `worker_loaders` binding in `wrangler.jsonc` (plugin sandboxing)
requires the Workers Paid plan — comment it out to run on the free plan.

Manual deploy from a machine with `wrangler login`: `npm run deploy`.

Local/self-hosted alternative: `docker compose up` or `npm run build && npm
start` (SQLite + local uploads volume).

### Gallery media

Gallery photos are served from the EmDash **media library** (local `uploads/`
in dev, R2 in production) so admins can upload and genuinely delete photos
from the admin UI. Originals live in `source-assets/gallery/` (kept in git,
never deployed). After seeding a fresh database — locally or on a new
production deployment — populate the media library once:

```bash
node scripts/import-gallery-media.mjs                        # local dev
node scripts/import-gallery-media.mjs --url https://k9campout.com
```

The script is idempotent (dedupes by file, rebuilds the gallery blocks).
Photos are downscaled to 2048px (longest edge) before upload — full-res
originals stay in `source-assets/gallery/`; the media library only holds
display-size copies. Photos added later through the admin UI don't need
the script — it's only for bootstrapping the historical archive.

See `AGENTS.md` for schema and content-model details.
