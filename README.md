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

- **Cloudflare Workers**: `npm run deploy` (D1 database + R2 media, see `wrangler.jsonc`).
- **Docker / Node**: `docker compose up` or `npm run build && npm start`
  (SQLite + local uploads volume).

See `AGENTS.md` for schema and content-model details.
