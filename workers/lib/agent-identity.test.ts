// Copyright (c) 2026 Postbox contributors.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/APACHE-2.0

import { describe, expect, it } from "vitest";
import {
	extractActorEmail,
	resolveAgentAttribution,
	estimateAgentSendBytes,
} from "./agent-identity";

/** Build a syntactically-valid (unsigned) JWT with the given payload. */
function fakeJwt(payload: Record<string, unknown>): string {
	const b64 = (s: string) =>
		btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
	return `${b64(JSON.stringify({ alg: "none" }))}.${b64(JSON.stringify(payload))}.`;
}

function reqWithJwt(email: string): Request {
	return new Request("https://mcp/post", {
		headers: { "cf-access-jwt-assertion": fakeJwt({ email }) },
	});
}

describe("extractActorEmail", () => {
	it("prefers the DEV_USER_EMAIL override", () => {
		const req = reqWithJwt("jwt-user@example.com");
		expect(
			extractActorEmail(req, { DEV_USER_EMAIL: "Dev@Example.com" }),
		).toBe("dev@example.com");
	});

	it("reads the email claim from the Access JWT", () => {
		const req = reqWithJwt("Member@Example.com");
		expect(extractActorEmail(req, {})).toBe("member@example.com");
	});

	it("returns null when the JWT has no email claim", () => {
		const req = reqWithJwt("");
		const bad = new Request("https://mcp/post", {
			headers: { "cf-access-jwt-assertion": fakeJwt({ sub: "123" }) },
		});
		expect(extractActorEmail(req, {})).toBeNull();
		expect(extractActorEmail(bad, {})).toBeNull();
	});

	it("returns null for a malformed token", () => {
		const req = new Request("https://mcp/post", {
			headers: { "cf-access-jwt-assertion": "not.a.jwt" },
		});
		expect(extractActorEmail(req, {})).toBeNull();
	});

	it("returns null when there is no token and no override", () => {
		expect(
			extractActorEmail(new Request("https://mcp/post"), {}),
		).toBeNull();
	});

	it("ignores a DEV_USER_EMAIL that is not an email", () => {
		const req = reqWithJwt("jwt-user@example.com");
		expect(extractActorEmail(req, { DEV_USER_EMAIL: "not-an-email" })).toBe(
			"jwt-user@example.com",
		);
	});
});

describe("resolveAgentAttribution", () => {
	const member = (email: string) => email === "alice@example.com";

	it("attributes to the actor when the actor is a member", () => {
		expect(
			resolveAgentAttribution({
				actorEmail: "Alice@Example.com",
				mailboxOwner: "owner@example.com",
				isMember: member,
			}),
		).toEqual({ ok: true, senderEmail: "alice@example.com", via: "actor" });
	});

	it("fails closed when the actor is not a team member", () => {
		const r = resolveAgentAttribution({
			actorEmail: "intruder@example.com",
			mailboxOwner: "owner@example.com",
			isMember: member,
		});
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toMatch(/team member/i);
	});

	it("falls back to the mailbox owner when there is no actor identity", () => {
		expect(
			resolveAgentAttribution({
				actorEmail: null,
				mailboxOwner: "Owner@Example.com",
				isMember: member,
			}),
		).toEqual({ ok: true, senderEmail: "owner@example.com", via: "mailbox-owner" });
	});

	it("fails closed when neither actor nor owner resolves", () => {
		const r = resolveAgentAttribution({
			actorEmail: null,
			mailboxOwner: null,
			isMember: member,
		});
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toMatch(/attribute/i);
	});
});

describe("estimateAgentSendBytes", () => {
	it("counts body characters (same unit as the UI send path)", () => {
		expect(estimateAgentSendBytes("<p>hello</p>")).toBe("<p>hello</p>".length);
		expect(estimateAgentSendBytes("")).toBe(0);
	});
});
