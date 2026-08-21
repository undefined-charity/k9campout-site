This is an EmDash site -- a CMS built on Astro with a full admin UI. It is the
k9campout.com site, migrated from Jekyll (Minimal Mistakes theme); the visual
design intentionally replicates the original Minimal Mistakes "mint" look.

## Commands

```bash
npx emdash dev        # Start dev server (runs migrations, seeds, generates types)
npx emdash types      # Regenerate TypeScript types from schema
npx emdash seed       # Apply seed/seed.json to a fresh data.db (schema + all content)
```

The admin UI is at `http://localhost:4321/_emdash/admin`.

## Key Files

| File                          | Purpose                                                              |
| ----------------------------- | -------------------------------------------------------------------- |
| `astro.config.mjs`            | Astro config with `emdash()` integration, database, and storage      |
| `src/live.config.ts`          | EmDash loader registration (boilerplate -- don't modify)             |
| `seed/seed.json`              | Full schema + content export (posts, pages, taxonomies, menus)       |
| `emdash-env.d.ts`             | Generated types for collections (auto-regenerated on dev start)      |
| `src/layouts/SiteLayout.astro`| Minimal Mistakes skeleton (masthead, nav, footer) with EmDash wiring |
| `public/assets/css/main.css`  | Compiled Minimal Mistakes 4.28 stylesheet from the old Jekyll site   |
| `public/assets/js/main.min.js`| Minimal Mistakes JS bundle (greedy nav etc.)                         |
| `src/pages/`                  | Astro pages -- all server-rendered                                   |

## Schema

- `posts` collection: `title`, `date` (datetime -- display/sort date), `excerpt`
  (plain text for archive listings), `content` (Portable Text), `permalink`
  (original Jekyll URL path, e.g. `/updates/1-Week-ToGo/` -- preserves old URLs
  including their letter case).
- `pages` collection: `title`, `description`, `content`, plus
  `redirect_url`/`redirect_delay` (0s delay → HTTP 302, used by /semiperm26;
  positive delay → rendered meta-refresh page, used by /tickets).
- Year-scoped pages use slugs like `2025-schedule`, routed via
  `src/pages/[year]/[slug].astro` to `/2025/schedule`.
- Taxonomies: `category` (updates, events), `tag`. Post URLs follow the old
  Jekyll permalink `/:categories/:title/` via `src/pages/updates/[...path].astro`.
- `attendees` collection: one entry per ticket (`year`, `ticket_type`,
  `ticket_code` masked, `order_id`, `site`, `tag_name`, `bus`, `sort`). Rows
  are added/edited individually via admin UI, MCP, or CLI — never as one giant
  embedded table. Pages display them with the `collection_table` Portable Text
  block (see plugins/collection-table): insert via "/" → Collection Table in
  the editor, configured with collection/filter/order/columns. Column syntax
  `field:Label:last3` masks all but the trailing chars (****abc); fields not
  listed (telegram, email, full codes) are never rendered — the content API
  is auth-gated and attendee fields are excluded from public search, so the
  collection safely holds the full operational roster. The 2025
  archive page keeps its old embedded table.

- Ticket Tailor bookings flow in automatically via `plugins/tickettailor`:
  Ticket Tailor's webhook points at `/_emdash/api/plugins/tickettailor/ingest`
  (`src/server/tickettailor-ingest.ts`, injected by an inline integration in
  `astro.config.mjs` — Astro ignores `_underscore` dirs in `src/pages`). The
  route captures the raw body — plugin routes never see raw bytes — forwards
  it to the plugin's `webhook-signed` route, which verifies Ticket Tailor's
  HMAC signature with the signing secret from Settings → Ticket Tailor, then
  **publishes the created entry in-process** via
  `locals.emdash.handleContentPublish` (plugins can't change content status,
  and a Worker can't `fetch()` its own hostname — 522 — so in-process is the
  only publish path; the `/_emdash/api/plugins/` prefix is what grants both
  the full runtime surface and webhook-passable Origin-based CSRF). Each
  ISSUED_TICKET.CREATED becomes a published attendee with normalization
  applied (type prefix/suffix stripped, site N/A or TBD, tag/telegram/bus
  from custom questions, tag_printed No). Every new entry is flagged in the
  plugin's review queue — the Settings → Ticket Tailor page lists pending
  entries with "Mark reviewed" / "Remove entry" actions and a delivery log.
  Voided tickets are flagged there too; nothing is ever auto-deleted
  (curated collection).

## Portable Text notes

- Tables use EmDash's native `table` block (editable in admin).
- Galleries are native `gallery` blocks whose images reference the media
  library. Originals: `source-assets/gallery/`; bootstrap a fresh media store
  with `node scripts/import-gallery-media.mjs [--url <instance>]`. Deleting a
  photo = remove it from the gallery block (page) and/or delete the media item
  (Media section) — the file is gone from the site either way.
- `---` rules became native `break` blocks.
- Script/iframe embeds (Telegram post widgets) use the custom `raw_html` block,
  rendered unsanitized by `src/components/blocks/RawHtml.astro` via
  `src/components/PT.astro`. Only use `raw_html` for trusted content; prefer
  the sanitized native `htmlBlock` for everything else.

## Deployment

Same dual-target setup as the sibling sites:

- `npm run build` / Docker -- Node + SQLite (`data.db`) + local uploads.
- `npm run deploy` -- Cloudflare Workers (D1 + R2) via wrangler (`EMDASH_TARGET=cloudflare`).

The old GitHub-Pages Jekyll workflow was removed on this branch; a server
runtime is required (GitHub Pages cannot host this).

## Rules

- All content pages must be server-rendered (`output: "server"`). No `getStaticPaths()` for CMS content.
- Image fields are objects (`{ src, alt }`), not strings. Use `<Image image={...} />` from `"emdash/ui"`.
- `entry.id` is the slug (for URLs). `entry.data.id` is the database ULID (for API calls like `getEntryTerms`).
- Always call `Astro.cache.set(cacheHint)` on pages that query content.
- Taxonomy names in queries must match the seed's `"name"` field exactly (`"category"`, `"tag"`).
- Keep the Minimal Mistakes markup classes intact -- the design comes from the
  compiled `main.css`; changing class names silently unstyles things.

## Monitoring

UptimeRobot (same account/pattern as the Chateau Woofy site) watches three
keyword monitors at 5-minute intervals, alerting via the n8n webhook + push:

- **K9 Campout Site** — `/` must contain "K9 Campout" (catches broken
  renders, not just hard downtime).
- **K9 Campout Attendee List** — `/2026/ticketed-puppies` must contain
  "Tag Name" (proves the D1 → collection-table render path).
- **K9 Campout TT Webhook** — GET `/api/tickettailor-webhook` must contain
  "webhook endpoint" (proves the rewrite + injected route + plugin registry).

Monitors are managed via the UptimeRobot API; the key is NOT stored in
this repo.

## Skills

Agent skills are in `.agents/skills/`. Load them when working on specific tasks:

- **building-emdash-site** -- Querying content, rendering Portable Text, schema design, seed files, site features. Start here.
- **creating-plugins** -- Building EmDash plugins.
- **emdash-cli** -- CLI commands for content management, seeding, type generation.

## Documentation

The EmDash docs are available as an MCP server at `https://docs.emdashcms.com/mcp`
(`.mcp.json` is checked in). Verify APIs against the live docs rather than recall.
