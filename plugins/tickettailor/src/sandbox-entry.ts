import type { PluginContext, SandboxedPlugin } from "emdash/plugin";

/**
 * Runtime entry for the Ticket Tailor webhook plugin.
 *
 * Flow: Ticket Tailor POSTs a webhook per issued ticket. The site-level
 * front door (src/pages/_emdash/api/plugins/tickettailor/ingest.ts) captures the RAW
 * request body — which EmDash plugin routes never see — and forwards
 * `{ raw, signature }` to the public `webhook-signed` route here, where the
 * HMAC signature is verified against the Ticket Tailor signing secret
 * (Settings → Ticket Tailor).
 *
 * Each ISSUED_TICKET.CREATED becomes an attendee entry with the site's
 * normalization rules applied, is AUTO-PUBLISHED (live on the public
 * ticketed-puppies list immediately, with the details the buyer provided),
 * and is flagged in the plugin's review queue. Admins review new entries
 * on the plugin page (Settings → Ticket Tailor): "Mark reviewed" clears
 * the flag, "Remove entry" trashes a bogus/voided entry. Voided tickets
 * are flagged the same way — never auto-deleted (curated collection).
 *
 * Publishing: plugins cannot change content status, and a Worker cannot
 * fetch() its own hostname (Cloudflare blocks self-calls with a 522), so
 * the FRONT DOOR publishes the entry in-process via
 * locals.emdash.handleContentPublish after this plugin returns the new
 * entry id. The review UI derives live/draft status live from the entry.
 *
 * KV settings: `settings:ttSecret`  — Ticket Tailor webhook signing secret
 *              `settings:year`, `settings:eventFilter`
 * Storage: `events` — webhook delivery log
 *          `queue`  — review flags, id = attendee entry id
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
		| "created_draft"
		| "duplicate"
		| "replayed"
		| "ignored_event"
		| "filtered_event"
		| "voided_needs_review"
		| "error";
	detail: string;
	raw: string;
}

interface QueueEntry {
	state: "pending" | "voided";
	createdAt: string;
	tag: string;
	code: string;
	type: string;
	site: string;
	telegram: string;
	bus: string;
	email: string;
	holder: string;
	note?: string;
}

interface Settings {
	ttSecret: string | null;
	year: string;
	eventFilter: string | null;
}

async function getSettings(ctx: PluginContext): Promise<Settings> {
	const [ttSecret, year, eventFilter] = await Promise.all([
		ctx.kv.get<string>("settings:ttSecret"),
		ctx.kv.get<string>("settings:year"),
		ctx.kv.get<string>("settings:eventFilter"),
	]);
	return {
		ttSecret: ttSecret ?? null,
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

/**
 * Ticket Tailor API ids carry type prefixes ("or_81028610") but the curated
 * roster stores bare numbers ("81028610") — strip the prefix on ingest.
 */
function normalizeOrderId(raw: string): string {
	return raw.replace(/^or_/i, "");
}

/**
 * Telegram answers arrive as free text; the roster stores bare handles
 * (no @, no t.me/ URL). Placeholder answers ("N/A", "none", "-") become
 * empty rather than polluting the private column.
 */
function normalizeTelegram(raw: string): string {
	const cleaned = raw
		.replace(/^https?:\/\/(www\.)?t(elegram)?\.me\//i, "")
		.replace(/^@+/, "")
		.trim();
	if (/^(n\/?a|none|nil|no|nope|-+|\.+)$/i.test(cleaned)) return "";
	return cleaned;
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

// =============================================================================
// Ticket Tailor signature verification (front-door path)
// =============================================================================

/**
 * Verify `Tickettailor-Webhook-Signature: t=<unix ts>,s=<hmac>` where the
 * HMAC-SHA256 is computed over `timestamp + raw body` with the account's
 * webhook signing secret. Accepts hex or base64 signature encodings and
 * rejects timestamps outside a 5-minute window (replay protection).
 */
async function verifyTicketTailorSignature(
	raw: string,
	header: string,
	secret: string,
): Promise<{ ok: boolean; reason?: string }> {
	const parts = new Map<string, string>();
	for (const piece of header.split(",")) {
		const [k, ...rest] = piece.split("=");
		if (k && rest.length) parts.set(k.trim(), rest.join("=").trim());
	}
	const timestamp = parts.get("t");
	const provided = parts.get("s") ?? parts.get("v1");
	if (!timestamp || !provided) return { ok: false, reason: "malformed signature header" };

	const ts = Number(timestamp);
	if (!Number.isFinite(ts)) return { ok: false, reason: "bad timestamp" };
	const skew = Math.abs(Date.now() / 1000 - ts);
	if (skew > 300) return { ok: false, reason: `timestamp outside 5-minute window (${Math.round(skew)}s)` };

	const enc = new TextEncoder();
	const cryptoKey = await crypto.subtle.importKey(
		"raw",
		enc.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const mac = new Uint8Array(
		await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(timestamp + raw)),
	);
	const hex = Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
	let b64 = "";
	try {
		b64 = btoa(String.fromCharCode(...mac));
	} catch {
		// btoa unavailable — hex comparison still applies
	}
	if (timingSafeEqual(provided.toLowerCase(), hex) || timingSafeEqual(provided, b64)) {
		return { ok: true };
	}
	return { ok: false, reason: "signature mismatch" };
}

// =============================================================================
// Attendee pipeline
// =============================================================================

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

/** Shared processing for both webhook routes (after authentication). */
async function processWebhook(input: WebhookEnvelope, ctx: PluginContext): Promise<unknown> {
	const settings = await getSettings(ctx);
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
	// Tolerant matching: "ev_8201998", "es_8201998" and bare "8201998" all
	// refer to the same event; compare with prefixes stripped, against both
	// the event id and the event-series id. Payloads carrying neither id
	// pass through (fail-open — the log surfaces them for review).
	if (settings.eventFilter) {
		const stripPrefix = (v: string) => v.replace(/^e[vs]_/i, "");
		const wanted = stripPrefix(settings.eventFilter);
		const carried = [asString(payload.event_id), asString(payload.event_series_id)]
			.filter(Boolean)
			.map(stripPrefix);
		const eventId = carried[0] ?? "";
		if (carried.length > 0 && !carried.includes(wanted)) {
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
	// Flag them in the review queue so they surface on the plugin page.
	if (eventName.includes("VOIDED") || asString(payload.status).toLowerCase() === "voided") {
		await ctx.kv.set(seenKey, now);
		const detail = `Ticket ${ticketCode || "?"} (${holder || "unknown holder"}) was VOIDED in Ticket Tailor — remove its attendee entry if it exists.`;
		try {
			await ctx.storage.queue.put(`voided-${webhookId}`, {
				state: "voided",
				createdAt: now,
				tag: "",
				code: ticketCode,
				type: "",
				site: "",
				telegram: "",
				bus: "",
				email: asString(payload.email),
				holder,
				note: detail,
			} satisfies QueueEntry);
		} catch (error) {
			ctx.log.error("Failed to queue voided ticket", error);
		}
		await logEvent(ctx, webhookId, {
			createdAt: now,
			event: eventName,
			outcome: "voided_needs_review",
			detail,
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
		const orderId = normalizeOrderId(asString(payload.order_id));
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
			telegram: normalizeTelegram(answers.telegram),
			email,
			tag_printed: "No",
			sort: scan.maxSort + 10,
		});

		// Flag for review on the plugin page. The front door publishes the
		// entry right after this handler returns (see file header).
		await ctx.storage.queue.put(created.id, {
			state: "pending",
			createdAt: now,
			tag: answers.tagName || "TBD",
			code: ticketCode,
			type: ticketType,
			site,
			telegram: normalizeTelegram(answers.telegram),
			bus: normalizeYesNo(answers.bus),
			email,
			holder,
		} satisfies QueueEntry);

		await ctx.kv.set(seenKey, now);
		await logEvent(ctx, webhookId, {
			createdAt: now,
			event: eventName,
			outcome: "created",
			detail: `Attendee created: tag "${answers.tagName || "TBD"}", ${ticketType}, ticket ${ticketCode} — flagged for review`,
			raw,
		});
		ctx.log.info("Ticket Tailor: attendee created", { id: created.id, ticketCode });
		return { ok: true, outcome: "created", id: created.id, collection: "attendees" };
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
	created: "Published",
	created_draft: "Draft only",
	duplicate: "Duplicate ticket",
	replayed: "Replayed delivery",
	ignored_event: "Ignored event",
	filtered_event: "Other TT event",
	voided_needs_review: "VOIDED — review!",
	error: "Error",
};

function describeQueueEntry(entry: QueueEntry, entryStatus: string | null): string {
	if (entry.state === "voided") {
		return `🚫 ${entry.note ?? `Ticket ${entry.code} was voided — remove its entry if it exists.`}`;
	}
	const bits = [
		`**${entry.tag}** — ${entry.type}`,
		`ticket ${entry.code}`,
		`site ${entry.site}`,
	];
	if (entry.telegram) bits.push(`telegram ${entry.telegram}`);
	if (entry.bus) bits.push(`bus ${entry.bus}`);
	if (entry.email) bits.push(entry.email);
	if (entry.holder) bits.push(`buyer ${entry.holder}`);
	const status =
		entryStatus === "published"
			? "live on the public list"
			: entryStatus === null
				? "⚠️ entry no longer exists — dismiss this flag"
				: `⚠️ ${entryStatus.toUpperCase()} — not on the public list (publish it in Content → Attendees)`;
	return `${bits.join(" · ")}\n_${status}_`;
}

async function buildSettingsPage(ctx: PluginContext) {
	const settings = await getSettings(ctx);
	const signedUrl = ctx.url("/api/tickettailor-webhook");

	const [queueResult, recent] = await Promise.all([
		ctx.storage.queue.query({ orderBy: { createdAt: "asc" }, limit: 50 }),
		ctx.storage.events.query({ orderBy: { createdAt: "desc" }, limit: 15 }),
	]);
	const queue = queueResult.items as Array<{ id: string; data: QueueEntry }>;

	// Live entry status per pending flag (published / draft / gone) so the
	// queue never shows stale state.
	const statuses = new Map<string, string | null>();
	await Promise.all(
		queue.map(async (item) => {
			if (item.data.state !== "pending") return;
			const entry = await ctx.content?.get("attendees", item.id);
			statuses.set(item.id, entry?.status ?? null);
		}),
	);

	const reviewBlocks =
		queue.length === 0
			? [
					{
						type: "section" as const,
						text: "_Nothing awaiting review — new bookings will appear here automatically._",
					},
				]
			: queue.flatMap((item) => [
					{ type: "section" as const, text: describeQueueEntry(item.data, statuses.get(item.id) ?? null) },
					{
						type: "actions" as const,
						elements: [
							{
								type: "button" as const,
								action_id: "approve_entry",
								label: item.data.state === "voided" ? "Dismiss flag" : "Mark reviewed",
								style: "primary" as const,
								value: item.id,
							},
							...(item.data.state === "pending"
								? [
										{
											type: "button" as const,
											action_id: "remove_entry",
											label: "Remove entry",
											style: "danger" as const,
											value: item.id,
											confirm: {
												title: "Remove attendee entry?",
												text: `This trashes the entry for "${item.data.tag}" (ticket ${item.data.code}). Use for bogus or refunded bookings.`,
												confirm: "Remove",
												deny: "Cancel",
											},
										},
									]
								: []),
						],
					},
					{ type: "divider" as const },
				]);

	return {
		blocks: [
			{ type: "header", text: `Pending review (${queue.length})` },
			{
				type: "section",
				text: "New Ticket Tailor bookings are added to the public attendee list immediately with the details the buyer provided, and flagged here for review. Fix anything odd (tag name, site) in Content → Attendees, then mark the entry reviewed. Voided tickets are flagged too — nothing is ever removed automatically.",
			},
			...reviewBlocks,
			{ type: "header", text: "Settings" },
			{
				type: "section",
				text: `**Webhook URL** for Ticket Tailor (Settings → API & webhooks → Add webhook):\n\`${signedUrl}\`\nDeliveries are verified with your Ticket Tailor **webhook signing secret** below — no secret in the URL needed.`,
			},
			{
				type: "form",
				block_id: "settings",
				fields: [
					{
						type: "secret_input",
						action_id: "ttSecret",
						label: "Ticket Tailor webhook signing secret",
						placeholder: "Shown by Ticket Tailor when you create the webhook",
						has_value: !!settings.ttSecret,
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
	// Secret inputs echo a mask when unchanged — only store real values.
	for (const field of ["ttSecret"] as const) {
		const value = asString(values[field]);
		if (value && value !== "********") {
			await ctx.kv.set(`settings:${field}`, value);
		}
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
	value?: unknown;
	values?: FormValues;
}

async function handleReviewAction(ctx: PluginContext, interaction: AdminInteraction) {
	const entryId = asString(interaction.value);
	if (!entryId) {
		return {
			...(await buildSettingsPage(ctx)),
			toast: { message: "Missing entry reference", type: "error" },
		};
	}

	if (interaction.action_id === "approve_entry") {
		await ctx.storage.queue.delete(entryId);
		return {
			...(await buildSettingsPage(ctx)),
			toast: { message: "Marked reviewed", type: "success" },
		};
	}

	if (interaction.action_id === "remove_entry") {
		try {
			const removed = (await ctx.content?.delete?.("attendees", entryId)) ?? false;
			await ctx.storage.queue.delete(entryId);
			return {
				...(await buildSettingsPage(ctx)),
				toast: {
					message: removed ? "Entry removed" : "Entry was already gone — flag cleared",
					type: "success",
				},
			};
		} catch (error) {
			ctx.log.error("Failed to remove attendee entry", error);
			return {
				...(await buildSettingsPage(ctx)),
				toast: {
					message: `Remove failed: ${error instanceof Error ? error.message : error}`,
					type: "error",
				},
			};
		}
	}

	return buildSettingsPage(ctx);
}

export default {
	routes: {
		/**
		 * Signed webhook target, fed by the site front door with the raw
		 * body bytes so Ticket Tailor's HMAC can be verified for real.
		 */
		"webhook-signed": {
			public: true,
			handler: async (routeCtx, ctx) => {
				const input = routeCtx.input as { raw?: string; signature?: string };
				const raw = typeof input?.raw === "string" ? input.raw : "";
				const signature = asString(input?.signature);
				const settings = await getSettings(ctx);

				if (!settings.ttSecret) {
					throw new Error(
						"Ticket Tailor signing secret not configured (Settings → Ticket Tailor)",
					);
				}
				if (!raw || !signature) {
					throw new Error("Missing body or Tickettailor-Webhook-Signature header");
				}

				const verdict = await verifyTicketTailorSignature(raw, signature, settings.ttSecret);
				if (!verdict.ok) {
					ctx.log.warn("Ticket Tailor signature rejected", { reason: verdict.reason });
					throw new Error(`Signature verification failed: ${verdict.reason}`);
				}

				let envelope: WebhookEnvelope;
				try {
					envelope = JSON.parse(raw) as WebhookEnvelope;
				} catch {
					throw new Error("Webhook body is not valid JSON");
				}
				return processWebhook(envelope, ctx);
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
			if (
				interaction.type === "block_action" &&
				(interaction.action_id === "approve_entry" || interaction.action_id === "remove_entry")
			) {
				return handleReviewAction(ctx, interaction);
			}
			// Table pagination and anything else: re-render the page.
			return buildSettingsPage(ctx);
		},
	},
} satisfies SandboxedPlugin;
