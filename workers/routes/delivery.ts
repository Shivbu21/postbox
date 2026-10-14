// Copyright (c) 2026 Postbox contributors.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/APACHE-2.0

/**
 * Provider delivery webhook — mounted at /api/v1/delivery (no team
 * membership required; the shared secret is the auth).
 *
 * Honest status: Cloudflare's Email Service binding (`send_email`) does
 * NOT emit delivery/bounce/complaint callbacks, so nothing wires to this
 * endpoint out of the box. It exists so a future provider (SES, SendGrid,
 * Postmark, …) — or a manual integration — can feed normalized events
 * into the delivery state machine without code changes. See MODULE2.md.
 */
import { Hono } from "hono";
import { z } from "zod";
import { teamStubFor } from "../lib/team";
import type { Env } from "../types";

const delivery = new Hono<{ Bindings: Env }>();

const WebhookBody = z.object({
	provider: z.string().min(1).max(60),
	provider_event_id: z.string().min(1).max(200),
	type: z.enum(["delivered", "bounced", "complained", "opened"]),
	provider_message_id: z.string().min(1).max(200),
	recipient: z.string().email().max(320).optional(),
	detail: z.record(z.unknown()).optional(),
});

function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

delivery.post("/webhook", async (c) => {
	const secret = (c.env as unknown as Record<string, unknown>).DELIVERY_WEBHOOK_SECRET;
	if (!secret || typeof secret !== "string") {
		return c.json({ error: "Delivery webhooks are not configured" }, 503);
	}
	const provided = c.req.header("x-delivery-secret") ?? "";
	if (!timingSafeEqual(provided, secret)) {
		return c.json({ error: "Forbidden" }, 403);
	}
	const body = WebhookBody.parse(await c.req.json());
	const result = await teamStubFor(c.env).recordDeliveryEvent({
		providerMessageId: body.provider_message_id,
		event: body.type,
		recipient: body.recipient,
		providerEventId: `${body.provider}:${body.provider_event_id}`,
		detail: body.detail ? JSON.stringify(body.detail) : undefined,
	});
	return c.json({ received: true, applied: result.applied, status: result.status });
});

export default delivery;
