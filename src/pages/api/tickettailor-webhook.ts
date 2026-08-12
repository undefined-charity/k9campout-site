/**
 * Back-compat alias for the Ticket Tailor webhook.
 *
 * The real receiver lives at /_emdash/api/plugins/tickettailor/ingest
 * (see src/server/tickettailor-ingest.ts for why that path is required).
 * This route lets the friendlier /api/tickettailor-webhook URL keep
 * working: it rewrites the request internally, which re-runs the
 * middleware chain against the /_emdash path so the ingest route gets the
 * full EmDash runtime surface it needs to publish entries. The raw body
 * passes through untouched, so signature verification is unaffected.
 */
import type { APIRoute } from "astro";

const INGEST_PATH = "/_emdash/api/plugins/tickettailor/ingest";

export const prerender = false;

export const GET: APIRoute = async (context) => context.rewrite(INGEST_PATH);

export const POST: APIRoute = async (context) =>
	context.rewrite(new Request(new URL(INGEST_PATH, context.url), context.request));
