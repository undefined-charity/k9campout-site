import { definePlugin } from "emdash";
import type { PluginDescriptor } from "emdash";

/**
 * Collection Table — a Portable Text block that renders a live table from any
 * content collection. Editors insert it via the "/" menu in any rich-text
 * field and configure the collection, filter, ordering, and columns; the
 * site renders the current entries at request time.
 *
 * Used for the attendee lists: rows live in the `attendees` collection (one
 * entry per ticket, edited individually), and pages just place this block.
 */
export function collectionTablePlugin(options = {}): PluginDescriptor {
	return {
		id: "collection-table",
		version: "0.1.0",
		entrypoint: "emdash-collection-table",
		componentsEntry: "emdash-collection-table/astro",
		options,
	};
}

export function createPlugin() {
	return definePlugin({
		id: "collection-table",
		version: "0.1.0",

		admin: {
			portableTextBlocks: [
				{
					type: "collection_table",
					label: "Collection Table",
					icon: "code",
					description: "Live table of entries from a content collection",
					fields: [
						{
							type: "text_input",
							action_id: "collection",
							label: "Collection slug",
							placeholder: "attendees",
						},
						{
							type: "text_input",
							action_id: "filter_field",
							label: "Filter field (optional)",
							placeholder: "year",
						},
						{
							type: "text_input",
							action_id: "filter_value",
							label: "Filter value (optional)",
							placeholder: "2026",
						},
						{
							type: "text_input",
							action_id: "order_by",
							label: "Order by field (optional)",
							placeholder: "sort",
						},
						{
							type: "text_input",
							action_id: "columns",
							label: "Columns as field:Label, comma-separated",
							placeholder: "ticket_type:Ticket Type, tag_name:Tag Name",
						},
						{
							type: "toggle",
							action_id: "show_last_updated",
							label: "Show 'Last updated' line",
						},
					],
				},
			],
		},
	});
}

export default createPlugin;
