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
 * Point Ticket Tailor's webhook at:  https://k9campout.com/api/tickettailor-webhook
 */
import type { APIRoute } from "astro";

export const prerender = false;

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

	return new Response(JSON.stringify(result.data ?? { ok: true }), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
};
