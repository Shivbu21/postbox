// Copyright (c) 2026 Postbox contributors.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/APACHE-2.0

/**
 * Identity attribution for AI-agent sends (Module 3).
 *
 * The AI agent reaches the send path only through the MCP server
 * (`send_email` / `send_reply` tools in workers/lib/tools.ts) — the chat
 * agent is draft-only by design. MCP requests arrive at the EmailMCP
 * Durable Object carrying the original HTTP headers, so the already-
 * verified Cloudflare Access JWT is available per session.
 *
 * Everything in this module is pure (no Cloudflare, DB, or Node imports)
 * so the attribution logic is unit-testable in plain Node with vitest.
 *
 * Resolution order for a send from `mailboxId`:
 *   1. actorEmail present + is a team member → attribute to the actor.
 *   2. actorEmail present + NOT a team member → FAIL CLOSED (clear error).
 *   3. no actorEmail (dev / no Access) + mailbox has an owner → attribute
 *      to the mailbox owner (dev fallback; in production the outer Access
 *      middleware guarantees a JWT, so this path is unreachable there).
 *   4. neither → FAIL CLOSED (clear error).
 */

import type { DeliveryOrigin } from "./delivery";

export type { DeliveryOrigin };

function base64UrlDecode(input: string): string {
	const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
	const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
	// atob is available in the Workers runtime and in Node 16+
	return atob(padded);
}

function claimEmailFromJwt(token: string): string | null {
	try {
		const payload = JSON.parse(base64UrlDecode(token.split(".")[1] ?? ""));
		const email = payload.email;
		if (typeof email === "string" && email.includes("@")) return email.toLowerCase();
	} catch {
		// malformed token — not our job to verify, just to read
	}
	return null;
}

/**
 * Extract the invoking user's email from an MCP request.
 *
 * NOTE: the JWT is NOT verified here — verification happens in the outer
 * Hono middleware (workers/app.ts), which 403s before the request ever
 * reaches /mcp in production. This only *reads* the already-verified claim.
 *
 * @param request - the incoming request (headers must be preserved).
 * @param env - needs only DEV_USER_EMAIL; structural type keeps this pure.
 */
export function extractActorEmail(
	request: Request,
	env: { DEV_USER_EMAIL?: string },
): string | null {
	// Explicit override (works in dev and production) — matches
	// getRequesterEmail in workers/lib/team.ts.
	const devEmail = env.DEV_USER_EMAIL;
	if (devEmail && typeof devEmail === "string" && devEmail.includes("@")) {
		return devEmail.toLowerCase();
	}
	// Production: Access JWT assertion carried on the original request.
	const token = request.headers.get("cf-access-jwt-assertion");
	if (token) return claimEmailFromJwt(token);
	return null;
}

export type AttributionInput = {
	/** Invoking user's email (from the Access JWT), or null when unknown. */
	actorEmail: string | null;
	/** The mailbox owner's team email, or null when the mailbox has none. */
	mailboxOwner: string | null;
	/** Membership check against the team. */
	isMember: (email: string) => boolean;
};

export type AttributionResult =
	| { ok: true; senderEmail: string; via: "actor" | "mailbox-owner" }
	| { ok: false; error: string };

/**
 * Decide which team identity an agent send is attributed to.
 * Fail-closed: unknown actors and non-members never get a silent pass.
 */
export function resolveAgentAttribution(input: AttributionInput): AttributionResult {
	const actor = input.actorEmail?.toLowerCase() ?? null;
	if (actor) {
		if (!input.isMember(actor)) {
			return { ok: false, error: "Not a team member — ask an admin to invite you" };
		}
		return { ok: true, senderEmail: actor, via: "actor" };
	}
	const owner = input.mailboxOwner?.toLowerCase() ?? null;
	if (owner) {
		return { ok: true, senderEmail: owner, via: "mailbox-owner" };
	}
	return {
		ok: false,
		error: "Could not attribute this send to a team member — set DEV_USER_EMAIL or sign in",
	};
}

/**
 * Estimate the outbound bytes of an agent send for quota accounting.
 * Agent sends carry no attachments, so this is just the body size —
 * same unit the UI send path uses (raw character length).
 */
export function estimateAgentSendBytes(bodyHtml: string): number {
	return bodyHtml.length;
}
