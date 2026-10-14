// Copyright (c) 2026 Postbox contributors.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/APACHE-2.0

/**
 * Delivery-status state machine for outbound email tracking.
 *
 * Pure module — no Cloudflare, DB, or Node imports — so it can be
 * unit-tested in plain Node with vitest.
 *
 * Lifecycle:
 *   queued ──► sent ──► delivered ──► bounced ──┐
 *     │          │            │          │       ├──► complained
 *     │          │            └──── opened (informational, keeps status)
 *     │          └─► send_failed (binding threw)
 *     └─► delivered/bounced/complained (webhook arrived before we recorded `sent`)
 *
 * `queued` is only ever the initial state. `opened` never changes the
 * status — it is recorded as an event for analytics only.
 */

export type DeliveryStatus =
	| "queued"
	| "sent"
	| "send_failed"
	| "delivered"
	| "bounced"
	| "complained";

export type DeliveryEventType =
	| "queued"
	| "sent"
	| "send_failed"
	| "delivered"
	| "bounced"
	| "complained"
	| "opened";

export const DELIVERY_STATUSES: DeliveryStatus[] = [
	"queued",
	"sent",
	"send_failed",
	"delivered",
	"bounced",
	"complained",
];

export const DELIVERY_EVENT_TYPES: DeliveryEventType[] = [
	"queued",
	"sent",
	"send_failed",
	"delivered",
	"bounced",
	"complained",
	"opened",
];

/**
 * Where a tracked send came from. `human` = the web UI (compose, reply,
 * forward); `agent` = the AI agent over MCP (`send_email` / `send_reply`
 * tools). Stored on delivery_messages.origin; older rows backfill to
 * `human`.
 */
export type DeliveryOrigin = "human" | "agent";

export const DELIVERY_ORIGINS: DeliveryOrigin[] = ["human", "agent"];

const TERMINAL_STATUSES: DeliveryStatus[] = ["send_failed", "bounced", "complained"];

// event -> resulting status, per current status. A missing entry means
// the transition is invalid and the event must be ignored (not applied).
const TRANSITIONS: Record<DeliveryStatus, Partial<Record<DeliveryEventType, DeliveryStatus>>> = {
	queued: {
		sent: "sent",
		send_failed: "send_failed",
		delivered: "delivered",
		bounced: "bounced",
		complained: "complained",
	},
	sent: {
		delivered: "delivered",
		bounced: "bounced",
		complained: "complained",
		send_failed: "send_failed",
		opened: "sent",
	},
	send_failed: {},
	delivered: {
		bounced: "bounced",
		complained: "complained",
		opened: "delivered",
	},
	bounced: {
		complained: "complained",
	},
	complained: {},
};

export function isTerminalStatus(status: DeliveryStatus): boolean {
	return (TERMINAL_STATUSES as string[]).includes(status);
}

/**
 * Returns the status after applying `event` to `current`, or null when
 * the transition is invalid (caller should ignore the event).
 * `queued` is only valid as the initial state — re-applying it is rejected.
 */
export function nextDeliveryStatus(
	current: DeliveryStatus,
	event: DeliveryEventType,
): DeliveryStatus | null {
	if (event === "queued") return null;
	return TRANSITIONS[current][event] ?? null;
}

export function isValidDeliveryEvent(current: DeliveryStatus, event: DeliveryEventType): boolean {
	return nextDeliveryStatus(current, event) !== null;
}

export interface DeliveryRateInput {
	sent: number;
	delivered: number;
	bounced: number;
	complained: number;
}

export interface DeliveryRates {
	deliveryRate: number; // delivered / sent, 0..1
	bounceRate: number; // bounced / sent, 0..1
	complaintRate: number; // complained / sent, 0..1
}

/** Pure rate math, unit-tested. Rates are 0 when nothing was sent. */
export function deliveryRates(input: DeliveryRateInput): DeliveryRates {
	const sent = Math.max(0, Math.floor(input.sent));
	if (sent === 0) return { deliveryRate: 0, bounceRate: 0, complaintRate: 0 };
	const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
	return {
		deliveryRate: clamp01(input.delivered / sent),
		bounceRate: clamp01(input.bounced / sent),
		complaintRate: clamp01(input.complained / sent),
	};
}
