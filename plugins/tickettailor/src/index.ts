import type { PluginDescriptor } from "emdash";

/**
 * Ticket Tailor integration — receives booking webhooks and creates DRAFT
 * entries in the `attendees` collection, one per issued ticket. Drafts are
 * reviewed (tag name / site normalization) and published from the admin UI,
 * which is what puts them on the public ticketed-puppies list.
 *
 * Webhook endpoint: /_emdash/api/plugins/tickettailor/webhook?key=<secret>
 * The key is set in Settings → Ticket Tailor. Ticket Tailor's HMAC signature
 * can't be verified here (plugin routes receive parsed JSON, never raw
 * bytes), so the URL key is the auth mechanism — treat the full URL as a
 * secret when configuring the webhook in Ticket Tailor.
 */
export function tickettailorPlugin(options = {}): PluginDescriptor {
	return {
		id: "tickettailor",
		version: "0.1.0",
		format: "standard",
		entrypoint: "emdash-tickettailor/sandbox",
		options,
		capabilities: ["content:read", "content:write"],
		storage: {
			events: { indexes: ["createdAt", "outcome"] },
			queue: { indexes: ["createdAt", "state"] },
		},
		adminPages: [{ path: "/settings", label: "Ticket Tailor", icon: "link" }],
	};
}

export default tickettailorPlugin;
