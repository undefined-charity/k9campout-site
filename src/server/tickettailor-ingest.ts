/**
 * Ticket Tailor webhook front door.
 *
 * EmDash plugin routes only ever receive parsed JSON — the raw request
 * bytes that Ticket Tailor's HMAC signature is computed over never reach
 * plugin code. This site-level endpoint exists purely to capture that raw
 * body and hand it (plus the signature header) to the tickettailor
 * plugin's public `webhook-signed` route, which owns the signing secret
 * and does the actual verification + attendee creation.
 *
 * Point Ticket Tailor's webhook at:  https://k9campout.com/_emdash/api/plugins/tickettailor/ingest
 *
 * The path matters twice over: EmDash's middleware only attaches the full
 * runtime surface (including handleContentPublish) to /_emdash requests,
 * and only the /_emdash/api/plugins/ namespace uses Origin-based CSRF
 * (which server-to-server webhooks pass) instead of requiring the
 * X-EmDash-Request header (which Ticket Tailor cannot send). Astro ignores
 * underscore-prefixed dirs in src/pages, so astro.config.mjs injects this
 * route explicitly; its static segments outrank EmDash's dynamic
 * [pluginId]/[...path] catch-all.
 */
import type { APIRoute } from "astro";

export const prerender = false;

/** Browsing here in a browser is a GET — answer helpfully instead of 404ing. */
export const GET: APIRoute = async () =>
	new Response(
		JSON.stringify({
			ok: true,
			info: "Ticket Tailor webhook endpoint. Deliveries arrive as signed POSTs; there is nothing to see via GET.",
		}),
		{ status: 200, headers: { "Content-Type": "application/json" } },
	);

export const POST: APIRoute = async ({ request, locals }) => {
	const emdash = locals.emdash;
	if (!emdash?.handlePublicPluginApiRoute) {
		return new Response(JSON.stringify({ ok: false, error: "not configured" }), {
			status: 500,
			headers: { "Content-Type": "application/json" },
		});
	}

	const raw = await request.text();
	const signature = request.headers.get("tickettailor-webhook-signature") ?? "";

	const forwarded = new Request(request.url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ raw, signature }),
	});

	const result = await emdash.handlePublicPluginApiRoute(
		"tickettailor",
		"POST",
		"/webhook-signed",
		forwarded,
	);

	if (!result.success) {
		const message = result.error?.message ?? "webhook rejected";
		// Non-2xx so Ticket Tailor retries transient failures; signature
		// failures also land here, which is fine — bad actors get no detail
		// beyond what the plugin chose to surface.
		return new Response(JSON.stringify({ ok: false, error: message }), {
			status: 400,
			headers: { "Content-Type": "application/json" },
		});
	}

	// Publish the entry the plugin just created. This must happen here:
	// plugin content access cannot change status, and a Worker cannot
	// fetch() its own hostname (Cloudflare rejects self-calls with a 522),
	// so in-process is the only reliable publish path. Only ids returned by
	// the plugin's just-verified webhook are ever published.
	const data = (result.data ?? {}) as {
		ok?: boolean;
		outcome?: string;
		id?: string;
		collection?: string;
	};
	let published = false;
	let publishError: string | undefined;
	if (data.outcome === "created" && data.id && emdash.handleContentPublish) {
		const pub = await emdash.handleContentPublish(data.collection ?? "attendees", data.id);
		published = pub.success;
		if (!pub.success) publishError = pub.error?.message ?? "publish failed";
	}

	return new Response(JSON.stringify({ ...data, published, publishError }), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
};
