import type { PluginContext, SandboxedPlugin } from "emdash/plugin";

/**
 * Runtime entry for the Ticket Tailor webhook plugin.
 *
 * Ticket Tailor POSTs a webhook per issued ticket (ISSUED_TICKET.CREATED).
 * This plugin receives it at
 *   /_emdash/api/plugins/tickettailor/webhook?key=<secret>
 * and creates a DRAFT entry in the `attendees` collection with the site's
 * normalization rules applied (ticket type stripped of "[Site N] " prefixes
 * and "(inc. ...)" suffixes; site N/A for event-only tickets, otherwise TBD
 * until an admin assigns one). Publishing the draft — after reviewing the
 * tag name — is what puts the pup on the public ticketed-puppies list.
 *
 * Auth: Ticket Tailor signs webhooks (HMAC over the raw body), but plugin
 * routes only receive parsed JSON, so the raw bytes needed to verify that
 * signature never reach us. Instead the webhook URL carries a `key` query
 * parameter matched against the secret configured in Settings → Ticket
 * Tailor. Treat the full URL as a secret.
 *
 * KV settings: `settings:key`, `settings:year`, `settings:eventFilter`.
 * Storage `events`: one row per received webhook (audit/debug log).
 */

interface WebhookEnvelope {
	id?: string;
	created_at?: number | string;
	event?: string;
	payload?: Record<string, unknown>;
}

interface EventLogEntry {
	createdAt: string;
	event: string;
	outcome:
		| "created"
		| "duplicate"
		| "replayed"
		| "ignored_event"
		| "filtered_event"
		| "voided_needs_review"
		| "error";
	detail: string;
	raw: string;
}

interface Settings {
	key: string | null;
	year: string;
	eventFilter: string | null;
}

async function getSettings(ctx: PluginContext): Promise<Settings> {
	const [key, year, eventFilter] = await Promise.all([
		ctx.kv.get<string>("settings:key"),
		ctx.kv.get<string>("settings:year"),
		ctx.kv.get<string>("settings:eventFilter"),
	]);
	return {
		key: key ?? null,
		year: year?.trim() || "2026",
		eventFilter: eventFilter?.trim() || null,
	};
}

/** Constant-time string comparison (both sides attacker-visible length). */
function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

function asString(value: unknown): string {
	if (value === null || value === undefined) return "";
	return String(value).trim();
}

/** "Event Only Ticket (inc. RoarSaidSo)" / "[Site 4] Weekend Pass" → clean type. */
function normalizeTicketType(raw: string): string {
	return raw
		.replace(/^\[[^\]]*\]\s*/, "")
		.replace(/\s*\(inc\.[^)]*\)/gi, "")
		.replace(/\s+/g, " ")
		.trim();
}

/** Yes/No normalization for the bus question. */
function normalizeYesNo(raw: string): string {
	if (!raw) return "";
	if (/^(y|yes|true|1)/i.test(raw)) return "Yes";
	if (/^(n|no|false|0)/i.test(raw)) return "No";
	return raw;
}

interface CustomAnswers {
	tagName: string;
	telegram: string;
	bus: string;
}

function extractCustomAnswers(payload: Record<string, unknown>): CustomAnswers {
	const out: CustomAnswers = { tagName: "", telegram: "", bus: "" };
	const questions = payload.custom_questions;
	if (!Array.isArray(questions)) return out;
	for (const entry of questions) {
		if (!entry || typeof entry !== "object") continue;
		const q = asString((entry as Record<string, unknown>).question).toLowerCase();
		const answer = asString((entry as Record<string, unknown>).answer);
		if (!q || !answer) continue;
		if (!out.tagName && /tag|dog ?tag|pup ?name/.test(q)) out.tagName = answer;
		else if (!out.telegram && /telegram/.test(q)) out.telegram = answer;
		else if (!out.bus && /bus|shuttle|transport/.test(q)) out.bus = answer;
	}
	return out;
}

interface AttendeeScan {
	duplicate: boolean;
	maxSort: number;
}

/**
 * Scan the attendees collection (all statuses) for an existing entry with
 * this ticket code, and find the current max sort so new entries append.
 */
async function scanAttendees(
	ctx: PluginContext,
	year: string,
	ticketCode: string,
): Promise<AttendeeScan> {
	const result: AttendeeScan = { duplicate: false, maxSort: 0 };
	if (!ctx.content) return result;
	let cursor: string | undefined;
	do {
		const page = await ctx.content.list("attendees", { limit: 100, cursor });
		for (const item of page.items) {
			const data = (item.data ?? {}) as Record<string, unknown>;
			const sort = Number(data.sort);
			if (Number.isFinite(sort) && sort > result.maxSort) result.maxSort = sort;
			if (
				ticketCode &&
				asString(data.year) === year &&
				asString(data.ticket_code).toLowerCase() === ticketCode.toLowerCase()
			) {
				result.duplicate = true;
			}
		}
		cursor = page.hasMore ? page.cursor : undefined;
	} while (cursor);
	return result;
}

async function logEvent(ctx: PluginContext, id: string, entry: EventLogEntry): Promise<void> {
	try {
		await ctx.storage.events.put(id, entry);
	} catch (error) {
		ctx.log.error("Failed to write Ticket Tailor event log", error);
	}
}

function truncateRaw(input: unknown): string {
	try {
		return JSON.stringify(input).slice(0, 4000);
	} catch {
		return "";
	}
}

async function handleWebhook(
	input: WebhookEnvelope,
	requestUrl: string,
	ctx: PluginContext,
): Promise<unknown> {
	const settings = await getSettings(ctx);

	// --- auth ---------------------------------------------------------------
	if (!settings.key) {
		throw new Error("Ticket Tailor plugin has no webhook key configured");
	}
	let providedKey = "";
	try {
		providedKey = new URL(requestUrl).searchParams.get("key") ?? "";
	} catch {
		providedKey = "";
	}
	if (!timingSafeEqual(providedKey, settings.key)) {
		ctx.log.warn("Ticket Tailor webhook rejected: bad key");
		throw new Error("Unauthorized");
	}

	const webhookId = asString(input?.id) || `no-id-${crypto.randomUUID()}`;
	const eventName = asString(input?.event).toUpperCase();
	const payload = (input?.payload ?? {}) as Record<string, unknown>;
	const raw = truncateRaw(input);
	const now = new Date().toISOString();

	// --- idempotency (Ticket Tailor retries deliveries) ---------------------
	const seenKey = `seen:${webhookId}`;
	if (await ctx.kv.get(seenKey)) {
		return { ok: true, outcome: "replayed" };
	}

	// --- event filtering ----------------------------------------------------
	if (settings.eventFilter) {
		const eventId = asString(payload.event_id) || asString(payload.event_series_id);
		if (eventId && eventId !== settings.eventFilter) {
			await ctx.kv.set(seenKey, now);
			await logEvent(ctx, webhookId, {
				createdAt: now,
				event: eventName,
				outcome: "filtered_event",
				detail: `event ${eventId} does not match filter ${settings.eventFilter}`,
				raw,
			});
			return { ok: true, outcome: "filtered_event" };
		}
	}

	const ticketCode = asString(payload.barcode) || asString(payload.reference);
	const holder = asString(payload.full_name) || asString(payload.email);

	// Voids need human eyes — the collection is curated, never auto-delete.
	if (eventName.includes("VOIDED") || asString(payload.status).toLowerCase() === "voided") {
		await ctx.kv.set(seenKey, now);
		await logEvent(ctx, webhookId, {
			createdAt: now,
			event: eventName,
			outcome: "voided_needs_review",
			detail: `Ticket ${ticketCode || "?"} (${holder || "unknown holder"}) was voided — remove its attendee entry manually if it exists.`,
			raw,
		});
		ctx.log.warn("Ticket Tailor: ticket voided, manual review needed", { ticketCode });
		return { ok: true, outcome: "voided_needs_review" };
	}

	if (!eventName.startsWith("ISSUED_TICKET.CREATED")) {
		await ctx.kv.set(seenKey, now);
		await logEvent(ctx, webhookId, {
			createdAt: now,
			event: eventName || "(none)",
			outcome: "ignored_event",
			detail: "Only ISSUED_TICKET.CREATED creates attendees",
			raw,
		});
		return { ok: true, outcome: "ignored_event" };
	}

	// --- build the attendee -------------------------------------------------
	try {
		if (!ctx.content?.create) {
			throw new Error("Missing content:write capability");
		}

		const rawType = asString(payload.description) || asString(payload.ticket_type_name);
		const ticketType = normalizeTicketType(rawType) || "TBD";
		const site = /event\s*only/i.test(ticketType) ? "N/A" : "TBD";
		const answers = extractCustomAnswers(payload);
		const orderId = asString(payload.order_id);
		const email = asString(payload.email);

		const scan = await scanAttendees(ctx, settings.year, ticketCode);
		if (scan.duplicate) {
			await ctx.kv.set(seenKey, now);
			await logEvent(ctx, webhookId, {
				createdAt: now,
				event: eventName,
				outcome: "duplicate",
				detail: `Ticket ${ticketCode} already has an attendee entry`,
				raw,
			});
			return { ok: true, outcome: "duplicate" };
		}

		const created = await ctx.content.create("attendees", {
			year: settings.year,
			ticket_type: ticketType,
			ticket_code: ticketCode,
			order_id: orderId,
			site,
			tag_name: answers.tagName || "TBD",
			bus: normalizeYesNo(answers.bus),
			telegram: answers.telegram,
			email,
			tag_printed: "No",
			sort: scan.maxSort + 10,
		});

		await ctx.kv.set(seenKey, now);
		await logEvent(ctx, webhookId, {
			createdAt: now,
			event: eventName,
			outcome: "created",
			detail: `Draft attendee ${created.id}: tag "${answers.tagName || "TBD"}", ${ticketType}, ticket ${ticketCode} — review & publish in Content → Attendees`,
			raw,
		});
		ctx.log.info("Ticket Tailor: draft attendee created", {
			id: created.id,
			ticketCode,
		});
		return { ok: true, outcome: "created", id: created.id };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await logEvent(ctx, webhookId, {
			createdAt: now,
			event: eventName,
			outcome: "error",
			detail: message,
			raw,
		});
		ctx.log.error("Ticket Tailor webhook failed", error);
		// Rethrow so Ticket Tailor sees a failure and retries (seenKey was
		// deliberately not set — the retry gets another chance to succeed).
		throw error;
	}
}

// =============================================================================
// Admin page (Block Kit)
// =============================================================================

const OUTCOME_LABELS: Record<string, string> = {
	created: "Draft created",
	duplicate: "Duplicate ticket",
	replayed: "Replayed delivery",
	ignored_event: "Ignored event",
	filtered_event: "Other TT event",
	voided_needs_review: "VOIDED — review!",
	error: "Error",
};

async function buildSettingsPage(ctx: PluginContext) {
	const settings = await getSettings(ctx);
	const webhookPath = "/_emdash/api/plugins/tickettailor/webhook";
	const webhookUrl = settings.key
		? ctx.url(`${webhookPath}?key=${encodeURIComponent(settings.key)}`)
		: null;

	const recent = await ctx.storage.events.query({
		orderBy: { createdAt: "desc" },
		limit: 15,
	});

	return {
		blocks: [
			{ type: "header", text: "Ticket Tailor" },
			{
				type: "section",
				text: "New Ticket Tailor bookings automatically become **draft** entries in the Attendees collection. Review the tag name and site, then publish the draft to add the pup to the public ticketed-puppies list. Voided tickets are never removed automatically — they show up in the log below for manual cleanup.",
			},
			...(webhookUrl
				? [
						{
							type: "section" as const,
							text: `**Webhook URL** (Ticket Tailor → Settings → API & webhooks → Add webhook, event \`Issued ticket → Created\`):\n\`${webhookUrl}\`\n\nThe \`key\` parameter is the only authentication on this endpoint — treat the full URL as a secret.`,
						},
					]
				: [
						{
							type: "section" as const,
							text: "⚠️ **No webhook key set.** Save a key below, then copy the webhook URL that appears here into Ticket Tailor.",
						},
					]),
			{
				type: "form",
				block_id: "settings",
				fields: [
					{
						type: "secret_input",
						action_id: "key",
						label: "Webhook key",
						placeholder: "Any long random string, e.g. from a password generator",
						has_value: !!settings.key,
						required: true,
					},
					{
						type: "text_input",
						action_id: "year",
						label: "Event year",
						placeholder: "2026",
						initial_value: settings.year,
						required: true,
					},
					{
						type: "text_input",
						action_id: "eventFilter",
						label: "Ticket Tailor event ID filter (optional)",
						placeholder: "e.g. ev_1234567 — leave blank to accept all events on the account",
						initial_value: settings.eventFilter ?? "",
					},
				],
				submit: { label: "Save Settings", action_id: "save_settings" },
			},
			{ type: "divider" },
			{ type: "header", text: "Recent webhook deliveries" },
			{
				type: "table",
				columns: [
					{ key: "when", label: "When", format: "relative_time" },
					{ key: "event", label: "Event" },
					{ key: "outcome", label: "Outcome", format: "badge" },
					{ key: "detail", label: "Detail" },
				],
				rows: recent.items.map((item) => {
					const data = item.data as EventLogEntry;
					return {
						when: data.createdAt,
						event: data.event,
						outcome: OUTCOME_LABELS[data.outcome] ?? data.outcome,
						detail: data.detail,
					};
				}),
				page_action_id: "events_page",
				empty_text: "No webhooks received yet.",
			},
		],
	};
}

type FormValues = Record<string, unknown>;

async function saveSettings(ctx: PluginContext, values: FormValues) {
	const key = asString(values.key);
	// The secret input echoes a mask when unchanged — only store real values.
	if (key && key !== "********") {
		if (key.length < 16) {
			return {
				...(await buildSettingsPage(ctx)),
				toast: { message: "Webhook key must be at least 16 characters", type: "error" },
			};
		}
		await ctx.kv.set("settings:key", key);
	}

	const year = asString(values.year);
	if (year) {
		if (!/^\d{4}$/.test(year)) {
			return {
				...(await buildSettingsPage(ctx)),
				toast: { message: "Event year must be a 4-digit year", type: "error" },
			};
		}
		await ctx.kv.set("settings:year", year);
	}

	await ctx.kv.set("settings:eventFilter", asString(values.eventFilter));

	return {
		...(await buildSettingsPage(ctx)),
		toast: { message: "Settings saved", type: "success" },
	};
}

interface AdminInteraction {
	type: string;
	page?: string;
	action_id?: string;
	values?: FormValues;
}

export default {
	routes: {
		webhook: {
			public: true,
			handler: async (routeCtx, ctx) => {
				return handleWebhook(
					routeCtx.input as WebhookEnvelope,
					routeCtx.request.url,
					ctx,
				);
			},
		},

		admin: async (routeCtx, ctx) => {
			const interaction = routeCtx.input as AdminInteraction;

			if (interaction.type === "page_load" && interaction.page === "/settings") {
				return buildSettingsPage(ctx);
			}
			if (interaction.type === "form_submit" && interaction.action_id === "save_settings") {
				return saveSettings(ctx, interaction.values ?? {});
			}
			// Table pagination and anything else: re-render the page.
			return buildSettingsPage(ctx);
		},
	},
} satisfies SandboxedPlugin;
