# Copilot Instructions for k9campout-site

## Build & Serve

```bash
# Install dependencies
bundle install

# Serve locally with live reload (http://localhost:4000)
bundle exec jekyll serve --livereload

# Build only (outputs to _site/)
bundle exec jekyll build
```

The CI workflow (`.github/workflows/jekyll.yml`) builds with `bundle exec jekyll build` using Ruby 3.3 and deploys to GitHub Pages on push to `main`.

## Architecture

This is a **Jekyll** site using the **Minimal Mistakes** remote theme (`mmistakes/minimal-mistakes`, "mint" skin), hosted on **GitHub Pages** at `k9campout.com`.

- **`_pages/`** — Static pages. Current-year pages live at the root (e.g., `schedule.md`, `tickets.md`). Previous years are archived under year subdirectories (`_pages/2022/`, `_pages/2023/`, `_pages/2024/`).
- **`_posts/`** — Blog-style announcements, named with Jekyll's `YYYY-MM-DD-title.md` convention.
- **`_data/navigation.yml`** — Defines the site's main navigation menu.
- **`_includes/head/custom.html`** — Custom `<head>` content: favicon links and the "PhosphatePro-Inline" logo font (`@font-face`). The `.site-title` and `div.logofont` classes use this font.
- **`_pages/index.md`** — Homepage, uses `layout: splash` with a hero banner image and paginated recent posts.

## Conventions

### Page Front Matter

All pages use YAML front matter with `layout`, `title`, `description`, and `permalink`. Example:

```yaml
---
layout: single
title: Schedule
description: "The what when and where"
permalink: /schedule
---
```

The gallery page uses a `gallery` front matter key for image data, rendered with `{% include gallery %}`.

### Year-over-Year Content

When a new year starts, current pages (schedule, gallery, etc.) get updated in-place and the previous year's versions are moved into a `_pages/YYYY/` subdirectory. Old schedule pages include a redirect notice pointing to `/schedule` for the current year.

### Post Format

Posts use `layout: single` with `date` and `categories` in front matter. The `categories: updates` tag is standard.

### External Links

External links use Markdown with `{:target="_blank"}` to open in new tabs:
```markdown
[Link text](https://example.com){:target="_blank"}
```
