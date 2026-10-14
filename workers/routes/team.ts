// Copyright (c) 2026 Postbox contributors.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/APACHE-2.0

/**
 * Team layer REST API — mounted at /api/v1/team.
 * All routes require team membership; mutating routes require admin.
 */
import { Hono } from "hono";
import { z } from "zod";
import { requireTeamMember, requireTeamAdmin, type TeamVariables } from "../lib/team";
import type { Env } from "../types";

const team = new Hono<{ Bindings: Env; Variables: TeamVariables }>();
team.use("*", requireTeamMember);

const UpdateProfileBody = z.object({
	name: z.string().min(1).max(120).optional(),
	domains: z.array(z.string().min(1).max(253)).max(20).optional(),
	brandName: z.string().max(120).nullable().optional(),
	logoUrl: z.string().url().max(2048).nullable().optional(),
});

const AddUserBody = z.object({
	email: z.string().email(),
	displayName: z.string().max(120).optional(),
	role: z.enum(["admin", "member"]).optional(),
	storageQuotaBytes: z.number().int().min(0).max(1024 ** 4).optional(),
	messagesPerDay: z.number().int().min(0).max(100000).optional(),
});

const UpdateUserBody = z.object({
	displayName: z.string().max(120).optional(),
	role: z.enum(["admin", "member"]).optional(),
	storageQuotaBytes: z.number().int().min(0).max(1024 ** 4).optional(),
	messagesPerDay: z.number().int().min(0).max(100000).optional(),
});

const ShareBody = z.object({
	userEmails: z.array(z.string().email()).max(200),
});

// -- Self ------------------------------------------------------------

team.get("/me", async (c) => {
	const stub = c.var.teamStub;
	const user = c.var.teamUser;
	const users = await stub.listUsers();
	const me = users.find((u) => u.email === user.email);
	return c.json({
		email: user.email,
		displayName: user.displayName,
		role: user.role,
		storageQuotaBytes: user.storageQuotaBytes,
		messagesPerDay: user.messagesPerDay,
		messagesSentToday: me?.messagesSent ?? 0,
		storageBytesUsed: me?.storageBytes ?? 0,
	});
});

// -- Team profile -----------------------------------------------------

team.get("/", async (c) => {
	return c.json(await c.var.teamStub.getProfile());
});

team.put("/", requireTeamAdmin, async (c) => {
	const body = UpdateProfileBody.parse(await c.req.json());
	const domains = body.domains?.map((d) => d.trim().toLowerCase()).filter(Boolean);
	return c.json(await c.var.teamStub.updateProfile({ ...body, domains }));
});

// -- Users (admin) ----------------------------------------------------

team.get("/users", requireTeamAdmin, async (c) => {
	return c.json(await c.var.teamStub.listUsers());
});

team.post("/users", requireTeamAdmin, async (c) => {
	const body = AddUserBody.parse(await c.req.json());
	try {
		const user = await c.var.teamStub.addUser(body);
		return c.json(user, 201);
	} catch (e) {
		if ((e as Error).message === "user-exists") {
			return c.json({ error: "User is already a team member" }, 409);
		}
		throw e;
	}
});

team.put("/users/:email", requireTeamAdmin, async (c) => {
	const target = decodeURIComponent(c.req.param("email")!).toLowerCase();
	const body = UpdateUserBody.parse(await c.req.json());
	// Prevent removing your own admin role (would lock the team out).
	if (target === c.var.teamUser.email && body.role === "member") {
		return c.json({ error: "You cannot demote yourself" }, 400);
	}
	const user = await c.var.teamStub.updateUser(target, body);
	if (!user) return c.json({ error: "User not found" }, 404);
	return c.json(user);
});

team.delete("/users/:email", requireTeamAdmin, async (c) => {
	const target = decodeURIComponent(c.req.param("email")!).toLowerCase();
	if (target === c.var.teamUser.email) {
		return c.json({ error: "You cannot remove yourself" }, 400);
	}
	const ok = await c.var.teamStub.removeUser(target);
	if (!ok) return c.json({ error: "User not found" }, 404);
	return c.body(null, 204);
});

// -- Mailbox sharing ---------------------------------------------------

team.get("/mailboxes/:mailboxId/shares", async (c) => {
	const mailboxId = decodeURIComponent(c.req.param("mailboxId")!);
	return c.json(await c.var.teamStub.getMailboxShares(mailboxId));
});

// -- Delivery analytics (Module 2) --------------------------------------

team.get("/delivery/stats", async (c) => {
	const rawDays = Number(c.req.query("days") ?? "7");
	const days = rawDays === 30 ? 30 : 7;
	const domain = c.req.query("domain")?.trim().toLowerCase() || undefined;
	const rawOrigin = c.req.query("origin");
	const origin = rawOrigin === "human" || rawOrigin === "agent" ? rawOrigin : "all";
	const user = c.var.teamUser;
	// Members are scoped to their own sends; admins see the whole team.
	const stats = await c.var.teamStub.getDeliveryStats({
		userEmail: user.email,
		isAdmin: user.role === "admin",
		days,
		domain,
		origin,
	});
	return c.json(stats);
});

team.put("/mailboxes/:mailboxId/shares", requireTeamAdmin, async (c) => {
	const mailboxId = decodeURIComponent(c.req.param("mailboxId")!);
	// Only share mailboxes that exist.
	if (!(await c.env.BUCKET.head(`mailboxes/${mailboxId}.json`))) {
		return c.json({ error: "Mailbox not found" }, 404);
	}
	const { userEmails } = ShareBody.parse(await c.req.json());
	await c.var.teamStub.setMailboxShares(mailboxId, userEmails);
	return c.json(await c.var.teamStub.getMailboxShares(mailboxId));
});

export { team };
