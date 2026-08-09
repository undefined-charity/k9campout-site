# Copilot Instructions for k9campout-site

This is an **EmDash** site (a CMS built on Astro) -- see `AGENTS.md` at the repo
root for the full development guide: commands, schema, content model, Portable
Text conventions, and deployment targets.

Quick start:

```bash
npm install
npx emdash dev   # http://localhost:4321 (admin UI at /_emdash/admin)
```

The visual design replicates the previous Jekyll Minimal Mistakes "mint" theme
via the compiled stylesheet in `public/assets/css/main.css`; keep the Minimal
Mistakes markup classes in `src/layouts/` and `src/components/` intact.
