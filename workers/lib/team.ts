// Copyright (c) 2026 Postbox contributors.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/APACHE-2.0

/**
 * Team membership middleware.
 *
 * Identity source:
 * - Production: the `email` claim of the already-verified Cloudflare Access
 *   JWT (verified by the outer middleware in workers/app.ts).
 * - Local dev: the DEV_USER_EMAIL var (defaults to admin@example.com).
 *
 * First-run bootstrap: when the team has zero users, the first visitor is
 * created as an admin automatically. After that, only existing members pass.
 */
import { createMiddleware } from "hono/factory";
import type { TeamDO, TeamUserRow } from "../durableObject/team";
import type { Env } from "../types";

export type TeamVariables = {
	teamStub: DurableObjectStub<TeamDO>;
	teamUser: TeamUserRow;
};

function base64UrlDecode(input: string): string {
	const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
	const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
	// atob is available in the Workers runtime and in Node 16+
	return atob(padded);
}

/** Extract the requester's email from the Access JWT or dev config. Never throws. */
export function getRequesterEmail(c: { req: { header: (n: string) => string | undefined }; env: Env }): string | null {
	// Explicit override (works in dev and production).
	const devEmail = (c.env as unknown as Record<string, unknown>).DEV_USER_EMAIL;
	if (devEmail && typeof devEmail === "string" && devEmail.includes("@")) {
		return devEmail.toLowerCase();
	}
	// Production: the Access JWT was already verified by the outer middleware.
	const token = c.req.header("cf-access-jwt-assertion");
	if (token) {
		try {
			const payload = JSON.parse(base64UrlDecode(token.split(".")[1] ?? ""));
			const email = payload.email;
			if (typeof email === "string" && email.includes("@")) return email.toLowerCase();
		} catch {
			// fall through to dev default / null
		}
	}
	// Local dev (`wrangler dev` / vite dev): Access is skipped, so default
	// to a local admin identity for a smooth first run.
	try {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		if ((import.meta as any).env?.DEV) return "admin@example.com";
	} catch {
		// ignore
	}
	return null;
}

export function teamStubFor(env: Env): DurableObjectStub<TeamDO> {
	const ns = (env as unknown as { TEAM: DurableObjectNamespace<TeamDO> }).TEAM;
	return ns.get(ns.idFromName("team"));
}

export const requireTeamMember = createMiddleware<{ Bindings: Env; Variables: TeamVariables }>(
	async (c, next) => {
		const email = getRequesterEmail(c);
		if (!email) {
			return c.json({ error: "Could not determine user identity (missing Access JWT email claim)" }, 403);
		}
		const stub = teamStubFor(c.env);
		let user: TeamUserRow;
		try {
			user = await stub.ensureBootstrap(email);
		} catch (e) {
			if ((e as Error).message === "not-a-member") {
				return c.json({ error: "Not a team member — ask an admin to invite you" }, 403);
			}
			throw e;
		}
		c.set("teamStub", stub);
		c.set("teamUser", user);
		await next();
	},
);

export const requireTeamAdmin = createMiddleware<{ Bindings: Env; Variables: TeamVariables }>(
	async (c, next) => {
		if (c.var.teamUser.role !== "admin") {
			return c.json({ error: "Admin only" }, 403);
		}
		await next();
	},
);
