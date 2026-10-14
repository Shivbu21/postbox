// Copyright (c) 2026 Postbox contributors.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/APACHE-2.0

/**
 * TeamDO — one Durable Object instance per deployment ("team").
 * Holds the team profile, members, quotas/usage, and mailbox shares.
 *
 * Durable Objects process one event at a time, so check-then-update
 * sequences inside a single RPC call (e.g. quota consume) are atomic
 * without explicit transactions.
 */
import { DurableObject } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/durable-sqlite";
import { eq, and } from "drizzle-orm";
import * as schema from "../db/team-schema";
import type { Env } from "../types";
import { applyMigrations, teamMigrations } from "./migrations";
import {
	nextDeliveryStatus,
	deliveryRates,
	type DeliveryStatus,
	type DeliveryEventType,
	type DeliveryRates,
	type DeliveryOrigin,
} from "../lib/delivery";

export const DEFAULT_STORAGE_QUOTA_BYTES = 10 * 1024 * 1024 * 1024; // 10 GB
export const DEFAULT_MESSAGES_PER_DAY = 200;

export interface TeamUserRow {
	email: string;
	displayName: string | null;
	role: "admin" | "member";
	storageQuotaBytes: number;
	messagesPerDay: number;
	createdAt: string;
}

export interface TeamUserWithUsage extends TeamUserRow {
	quotaDay: string;
	messagesSent: number;
	storageBytes: number;
}

export interface TeamProfile {
	id: string;
	name: string;
	domains: string[];
	brandName: string | null;
	logoUrl: string | null;
	createdAt: string;
	updatedAt: string;
}

function todayDay(): string {
	return new Date().toISOString().slice(0, 10); // UTC YYYY-MM-DD
}

export class TeamDO extends DurableObject<Env> {
	declare __DURABLE_OBJECT_BRAND: never;
	db: ReturnType<typeof drizzle>;

	constructor(state: DurableObjectState, env: Env) {
		super(state, env);
		this.db = drizzle(this.ctx.storage, { schema });
		applyMigrations(this.ctx.storage.sql, teamMigrations, this.ctx.storage);
	}

	// ── Profile ──────────────────────────────────────────────────

	async getProfile(): Promise<TeamProfile> {
		const rows = await this.db.select().from(schema.teamProfile).limit(1).all();
		const row = rows[0];
		if (!row) {
			const now = new Date().toISOString();
			const fresh: TeamProfile = {
				id: "team", name: "My Team", domains: [], brandName: null,
				logoUrl: null, createdAt: now, updatedAt: now,
			};
			await this.db.insert(schema.teamProfile).values({
				id: "team", name: fresh.name, domains: "[]",
				brandName: null, logoUrl: null, createdAt: now, updatedAt: now,
			});
			return fresh;
		}
		return {
			id: row.id, name: row.name,
			domains: JSON.parse(row.domains || "[]") as string[],
			brandName: row.brandName, logoUrl: row.logoUrl,
			createdAt: row.createdAt, updatedAt: row.updatedAt,
		};
	}

	async updateProfile(input: { name?: string; domains?: string[]; brandName?: string | null; logoUrl?: string | null }): Promise<TeamProfile> {
		await this.getProfile(); // ensure row exists
		const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() };
		if (input.name !== undefined) patch.name = input.name;
		if (input.domains !== undefined) patch.domains = JSON.stringify(input.domains);
		if (input.brandName !== undefined) patch.brandName = input.brandName;
		if (input.logoUrl !== undefined) patch.logoUrl = input.logoUrl;
		await this.db.update(schema.teamProfile).set(patch).where(eq(schema.teamProfile.id, "team"));
		return this.getProfile();
	}

	// ── Users ────────────────────────────────────────────────────

	async userCount(): Promise<number> {
		const rows = await this.db.select({ email: schema.teamUsers.email }).from(schema.teamUsers).all();
		return rows.length;
	}

	async getUser(email: string): Promise<TeamUserRow | null> {
		const rows = await this.db.select().from(schema.teamUsers).where(eq(schema.teamUsers.email, email.toLowerCase())).limit(1).all();
		const r = rows[0];
		if (!r) return null;
		return {
			email: r.email, displayName: r.displayName,
			role: r.role === "admin" ? "admin" : "member",
			storageQuotaBytes: r.storageQuotaBytes, messagesPerDay: r.messagesPerDay,
			createdAt: r.createdAt,
		};
	}

	/** First-run bootstrap: with zero users, the first visitor becomes admin. */
	async ensureBootstrap(email: string): Promise<TeamUserRow> {
		const existing = await this.getUser(email);
		if (existing) return existing;
		if ((await this.userCount()) > 0) {
			throw new Error("not-a-member");
		}
		const now = new Date().toISOString();
		const normalized = email.toLowerCase();
		await this.db.insert(schema.teamUsers).values({
			email: normalized,
			displayName: normalized.split("@")[0] || normalized,
			role: "admin",
			storageQuotaBytes: DEFAULT_STORAGE_QUOTA_BYTES,
			messagesPerDay: DEFAULT_MESSAGES_PER_DAY,
			createdAt: now,
		});
		await this.db.insert(schema.teamUsage).values({
			userEmail: normalized, quotaDay: todayDay(), messagesSent: 0, storageBytes: 0,
		});
		return (await this.getUser(normalized))!;
	}

	async addUser(input: { email: string; displayName?: string; role?: "admin" | "member"; storageQuotaBytes?: number; messagesPerDay?: number }): Promise<TeamUserRow> {
		const normalized = input.email.toLowerCase();
		if (await this.getUser(normalized)) throw new Error("user-exists");
		const now = new Date().toISOString();
		await this.db.insert(schema.teamUsers).values({
			email: normalized,
			displayName: input.displayName || normalized.split("@")[0] || normalized,
			role: input.role === "admin" ? "admin" : "member",
			storageQuotaBytes: input.storageQuotaBytes ?? DEFAULT_STORAGE_QUOTA_BYTES,
			messagesPerDay: input.messagesPerDay ?? DEFAULT_MESSAGES_PER_DAY,
			createdAt: now,
		});
		await this.db.insert(schema.teamUsage).values({
			userEmail: normalized, quotaDay: todayDay(), messagesSent: 0, storageBytes: 0,
		});
		return (await this.getUser(normalized))!;
	}

	async updateUser(email: string, input: { displayName?: string; role?: "admin" | "member"; storageQuotaBytes?: number; messagesPerDay?: number }): Promise<TeamUserRow | null> {
		const normalized = email.toLowerCase();
		if (!(await this.getUser(normalized))) return null;
		const patch: Record<string, unknown> = {};
		if (input.displayName !== undefined) patch.displayName = input.displayName;
		if (input.role !== undefined) patch.role = input.role;
		if (input.storageQuotaBytes !== undefined) patch.storageQuotaBytes = Math.max(0, Math.floor(input.storageQuotaBytes));
		if (input.messagesPerDay !== undefined) patch.messagesPerDay = Math.max(0, Math.floor(input.messagesPerDay));
		if (Object.keys(patch).length > 0) {
			await this.db.update(schema.teamUsers).set(patch).where(eq(schema.teamUsers.email, normalized));
		}
		return this.getUser(normalized);
	}

	async removeUser(email: string): Promise<boolean> {
		const normalized = email.toLowerCase();
		if (!(await this.getUser(normalized))) return false;
		await this.db.delete(schema.teamUsage).where(eq(schema.teamUsage.userEmail, normalized));
		await this.db.delete(schema.mailboxShares).where(eq(schema.mailboxShares.userEmail, normalized));
		await this.db.delete(schema.teamUsers).where(eq(schema.teamUsers.email, normalized));
		return true;
	}

	async listUsers(): Promise<TeamUserWithUsage[]> {
		const users = await this.db.select().from(schema.teamUsers).all();
		const usage = await this.db.select().from(schema.teamUsage).all();
		const usageByEmail = new Map(usage.map((u) => [u.userEmail, u]));
		return users.map((u) => {
			const us = usageByEmail.get(u.email);
			return {
				email: u.email, displayName: u.displayName,
				role: u.role === "admin" ? "admin" : "member",
				storageQuotaBytes: u.storageQuotaBytes, messagesPerDay: u.messagesPerDay,
				createdAt: u.createdAt,
				quotaDay: us?.quotaDay ?? todayDay(),
				messagesSent: us?.quotaDay === todayDay() ? (us?.messagesSent ?? 0) : 0,
				storageBytes: us?.storageBytes ?? 0,
			};
		});
	}

	// ── Quotas ───────────────────────────────────────────────────

	/**
	 * Check the user's send quota and consume one message + `bytes` of
	 * storage. Returns null on success, or a human-readable error.
	 */
	async checkAndConsumeSendQuota(email: string, bytes: number): Promise<string | null> {
		const user = await this.getUser(email);
		if (!user) return "Not a team member";
		const day = todayDay();
		let rows = await this.db.select().from(schema.teamUsage).where(eq(schema.teamUsage.userEmail, user.email)).limit(1).all();
		if (rows.length === 0) {
			await this.db.insert(schema.teamUsage).values({ userEmail: user.email, quotaDay: day, messagesSent: 0, storageBytes: 0 });
			rows = await this.db.select().from(schema.teamUsage).where(eq(schema.teamUsage.userEmail, user.email)).limit(1).all();
		}
		const u = rows[0]!;
		const messagesSent = u.quotaDay === day ? u.messagesSent : 0;
		if (messagesSent >= user.messagesPerDay) {
			return `Daily send limit reached (${user.messagesPerDay} messages/day)`;
		}
		if (u.storageBytes + bytes > user.storageQuotaBytes) {
			return `Storage quota exceeded (${formatBytes(user.storageQuotaBytes)} limit)`;
		}
		await this.db.update(schema.teamUsage).set({
			quotaDay: day, messagesSent: messagesSent + 1, storageBytes: u.storageBytes + bytes,
		}).where(eq(schema.teamUsage.userEmail, user.email));
		return null;
	}

	/** Best-effort inbound storage accounting (never throws). */
	async recordInboundStorage(email: string, bytes: number): Promise<void> {
		try {
			const user = await this.getUser(email);
			if (!user) return;
			const rows = await this.db.select().from(schema.teamUsage).where(eq(schema.teamUsage.userEmail, user.email)).limit(1).all();
			if (rows.length === 0) {
				await this.db.insert(schema.teamUsage).values({ userEmail: user.email, quotaDay: todayDay(), messagesSent: 0, storageBytes: bytes });
			} else {
				await this.db.update(schema.teamUsage).set({ storageBytes: rows[0]!.storageBytes + bytes }).where(eq(schema.teamUsage.userEmail, user.email));
			}
		} catch {
			// usage accounting must never break mail delivery
		}
	}

	// ── Mailbox shares ───────────────────────────────────────────

	async setMailboxOwner(mailboxId: string, ownerEmail: string): Promise<void> {
		const normalized = ownerEmail.toLowerCase();
		await this.db.delete(schema.mailboxShares).where(
			and(eq(schema.mailboxShares.mailboxId, mailboxId), eq(schema.mailboxShares.isOwner, 1)),
		);
		await this.db.insert(schema.mailboxShares).values({ mailboxId, userEmail: normalized, isOwner: 1 })
			.onConflictDoNothing();
	}

	async setMailboxShares(mailboxId: string, userEmails: string[]): Promise<void> {
		await this.db.delete(schema.mailboxShares).where(
			and(eq(schema.mailboxShares.mailboxId, mailboxId), eq(schema.mailboxShares.isOwner, 0)),
		);
		for (const e of userEmails) {
			const normalized = e.toLowerCase();
			if (!(await this.getUser(normalized))) continue; // only members
			await this.db.insert(schema.mailboxShares).values({ mailboxId, userEmail: normalized, isOwner: 0 })
				.onConflictDoNothing();
		}
	}

	async removeMailbox(mailboxId: string): Promise<void> {
		await this.db.delete(schema.mailboxShares).where(eq(schema.mailboxShares.mailboxId, mailboxId));
	}

	async getMailboxOwner(mailboxId: string): Promise<string | null> {
		const rows = await this.db.select().from(schema.mailboxShares).where(
			and(eq(schema.mailboxShares.mailboxId, mailboxId), eq(schema.mailboxShares.isOwner, 1)),
		).limit(1).all();
		return rows[0]?.userEmail ?? null;
	}

	async getMailboxShares(mailboxId: string): Promise<{ owner: string | null; sharedWith: string[] }> {
		const rows = await this.db.select().from(schema.mailboxShares).where(eq(schema.mailboxShares.mailboxId, mailboxId)).all();
		return {
			owner: rows.find((r) => r.isOwner === 1)?.userEmail ?? null,
			sharedWith: rows.filter((r) => r.isOwner === 0).map((r) => r.userEmail),
		};
	}

	/**
	 * Filter mailbox ids down to what `email` may see.
	 * Admins see everything. A mailbox with no share rows is visible to
	 * every member (template-compatible default).
	 */
	async filterVisibleMailboxIds(mailboxIds: string[], email: string, isAdmin: boolean): Promise<string[]> {
		if (isAdmin) return mailboxIds;
		if (mailboxIds.length === 0) return [];
		const normalized = email.toLowerCase();
		const placeholders = mailboxIds.map((_, i) => `?${i + 1}`).join(",");
		const rows = [
			...this.ctx.storage.sql.exec(
				`SELECT mailbox_id, user_email FROM mailbox_shares WHERE mailbox_id IN (${placeholders})`,
				...mailboxIds,
			),
		] as { mailbox_id: string; user_email: string }[];
		const byMailbox = new Map<string, Set<string>>();
		for (const r of rows) {
			if (!byMailbox.has(r.mailbox_id)) byMailbox.set(r.mailbox_id, new Set());
			byMailbox.get(r.mailbox_id)!.add(r.user_email);
		}
		return mailboxIds.filter((id) => {
			const shares = byMailbox.get(id);
			if (!shares || shares.size === 0) return true; // unshared = visible to all
			return shares.has(normalized);
		});
	}

	// ── Delivery tracking (Module 2) ─────────────────────────────

	/**
	 * Record a message handed to the send binding. Inserts the message row
	 * (status `queued`) and the initial `queued` event. Idempotent on
	 * messageId — a retry of the send route won't double-count.
	 */
	async recordDeliveryMessage(input: {
		messageId: string;
		senderEmail: string;
		mailboxId: string;
		domain: string;
		subject: string;
		recipientCount: number;
		/** Where the send came from; defaults to "human" (UI compose/reply/forward). */
		origin?: DeliveryOrigin;
	}): Promise<void> {
		const now = new Date().toISOString();
		await this.db
			.insert(schema.deliveryMessages)
			.values({
				messageId: input.messageId,
				providerMessageId: null,
				senderEmail: input.senderEmail.toLowerCase(),
				mailboxId: input.mailboxId,
				domain: input.domain.toLowerCase(),
				subject: input.subject.slice(0, 500),
				recipientCount: Math.max(0, Math.floor(input.recipientCount)),
				status: "queued",
				origin: input.origin ?? "human",
				createdAt: now,
				updatedAt: now,
			})
			.onConflictDoNothing();
		await this.db.insert(schema.deliveryEvents).values({
			messageId: input.messageId,
			eventType: "queued",
			recipient: null,
			providerEventId: null,
			detail: null,
			createdAt: now,
		});
	}

	/**
	 * Apply a delivery event to a message. Resolves the message by the
	 * internal id first, then by the provider's message id (for inbound
	 * webhooks that only know the provider id).
	 *
	 * Durable Objects run one event at a time, so the dedup check +
	 * insert below is atomic without an explicit transaction.
	 */
	async recordDeliveryEvent(input: {
		messageId?: string;
		providerMessageId?: string;
		event: DeliveryEventType;
		recipient?: string;
		providerEventId?: string;
		detail?: string;
	}): Promise<{ applied: boolean; status: DeliveryStatus | null }> {
		let rows =
			input.messageId
				? await this.db
						.select()
						.from(schema.deliveryMessages)
						.where(eq(schema.deliveryMessages.messageId, input.messageId))
						.limit(1)
						.all()
				: [];
		if (rows.length === 0 && input.providerMessageId) {
			rows = await this.db
				.select()
				.from(schema.deliveryMessages)
				.where(eq(schema.deliveryMessages.providerMessageId, input.providerMessageId))
				.limit(1)
				.all();
		}
		const msg = rows[0];
		if (!msg) return { applied: false, status: null };

		const current = msg.status as DeliveryStatus;
		const next = nextDeliveryStatus(current, input.event);
		if (!next) return { applied: false, status: current }; // invalid transition — ignore

		// Dedup retried provider webhooks on their event id.
		if (input.providerEventId) {
			const dup = await this.db
				.select({ id: schema.deliveryEvents.id })
				.from(schema.deliveryEvents)
				.where(eq(schema.deliveryEvents.providerEventId, input.providerEventId))
				.limit(1)
				.all();
			if (dup.length > 0) return { applied: false, status: current };
		}

		const now = new Date().toISOString();
		await this.db.insert(schema.deliveryEvents).values({
			messageId: msg.messageId,
			eventType: input.event,
			recipient: input.recipient?.toLowerCase() ?? null,
			providerEventId: input.providerEventId ?? null,
			detail: input.detail ?? null,
			createdAt: now,
		});
		const patch: Record<string, unknown> = { updatedAt: now };
		if (next !== current) patch.status = next;
		if (input.providerMessageId && !msg.providerMessageId) {
			patch.providerMessageId = input.providerMessageId;
		}
		await this.db
			.update(schema.deliveryMessages)
			.set(patch)
			.where(eq(schema.deliveryMessages.messageId, msg.messageId));
		return { applied: true, status: next };
	}

	/**
	 * Delivery analytics. Members only ever see their own sends
	 * (`scopedTo` = their email); admins see the whole team, including
	 * the per-user breakdown.
	 */
	async getDeliveryStats(input: {
		userEmail: string;
		isAdmin: boolean;
		days: number;
		domain?: string;
		/** Filter to one send origin; "all" (default) keeps both. */
		origin?: "all" | DeliveryOrigin;
	}): Promise<DeliveryStats> {
		const days = input.days === 30 ? 30 : 7;
		const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
		const normalized = input.userEmail.toLowerCase();

		const baseParts = ["m.created_at >= ?"];
		const baseParams: string[] = [cutoff];
		if (!input.isAdmin) {
			baseParts.push("m.sender_email = ?");
			baseParams.push(normalized);
		}
		if (input.domain) {
			baseParts.push("m.domain = ?");
			baseParams.push(input.domain.toLowerCase());
		}
		const baseWhere = baseParts.join(" AND ");

		// Agent sends in this scope/range, independent of the origin filter —
		// the stat card always shows the AI share of volume.
		const agentCountRows = [
			...this.ctx.storage.sql.exec(
				`SELECT COUNT(*) AS n FROM delivery_messages m WHERE ${baseWhere} AND m.origin = 'agent'`,
				...baseParams,
			),
		] as { n: number }[];
		const agentSends = Number(agentCountRows[0]?.n ?? 0);

		const whereParts = [...baseParts];
		const params: string[] = [...baseParams];
		if (input.origin === "human" || input.origin === "agent") {
			whereParts.push("m.origin = ?");
			params.push(input.origin);
		}
		const where = whereParts.join(" AND ");

		const msgRows = [
			...this.ctx.storage.sql.exec(
				`SELECT m.message_id, m.sender_email, m.domain, m.status, m.origin, substr(m.created_at, 1, 10) AS day
				 FROM delivery_messages m WHERE ${where}`,
				...params,
			),
		] as { message_id: string; sender_email: string; domain: string; status: string; origin: string; day: string }[];

		const eventRows = [
			...this.ctx.storage.sql.exec(
				`SELECT e.event_type, e.recipient, substr(e.created_at, 1, 10) AS day
				 FROM delivery_events e JOIN delivery_messages m ON m.message_id = e.message_id
				 WHERE ${where} AND e.event_type IN ('delivered', 'bounced', 'complained', 'opened')`,
				...params,
			),
		] as { event_type: string; recipient: string | null; day: string }[];

		const totals = { sent: 0, delivered: 0, bounced: 0, complained: 0, sendFailed: 0, queued: 0 };
		for (const m of msgRows) {
			totals.sent++;
			if (m.status === "delivered") totals.delivered++;
			else if (m.status === "bounced") totals.bounced++;
			else if (m.status === "complained") totals.complained++;
			else if (m.status === "send_failed") totals.sendFailed++;
			else if (m.status === "queued") totals.queued++;
		}
		const rates = deliveryRates(totals);

		const daily: DeliveryDayPoint[] = [];
		for (let i = days - 1; i >= 0; i--) {
			const day = new Date(Date.now() - i * 86400 * 1000).toISOString().slice(0, 10);
			daily.push({ day, sent: 0, delivered: 0, bounced: 0, complained: 0 });
		}
		const byDay = new Map(daily.map((p) => [p.day, p]));
		for (const m of msgRows) {
			const p = byDay.get(m.day);
			if (p) p.sent++;
		}
		for (const e of eventRows) {
			const p = byDay.get(e.day);
			if (!p) continue;
			if (e.event_type === "delivered") p.delivered++;
			else if (e.event_type === "bounced") p.bounced++;
			else if (e.event_type === "complained") p.complained++;
		}

		const groupBy = <K extends string>(rows: { message_id: string; sender_email: string; domain: string; status: string; origin: string }[], key: (r: (typeof rows)[number]) => K) => {
			const map = new Map<K, { sent: number; delivered: number; bounced: number; agentSends: number }>();
			for (const r of rows) {
				const k = key(r);
				let g = map.get(k);
				if (!g) { g = { sent: 0, delivered: 0, bounced: 0, agentSends: 0 }; map.set(k, g); }
				g.sent++;
				if (r.status === "delivered") g.delivered++;
				if (r.status === "bounced") g.bounced++;
				if (r.origin === "agent") g.agentSends++;
			}
			return [...map.entries()].map(([k, g]) => ({
				key: k, ...g, bounceRate: g.sent > 0 ? g.bounced / g.sent : 0,
			}));
		};

		const perDomain = groupBy(msgRows, (r) => r.domain)
			.map(({ key: domain, ...rest }) => ({ domain, ...rest }))
			.sort((a, b) => b.sent - a.sent);

		const bounceCounts = new Map<string, number>();
		for (const e of eventRows) {
			if (e.event_type === "bounced" && e.recipient) {
				bounceCounts.set(e.recipient, (bounceCounts.get(e.recipient) ?? 0) + 1);
			}
		}
		const topBounces = [...bounceCounts.entries()]
			.map(([recipient, count]) => ({ recipient, count }))
			.sort((a, b) => b.count - a.count)
			.slice(0, 10);

		const stats: DeliveryStats = {
			rangeDays: days,
			scopedTo: input.isAdmin ? null : normalized,
			totals: { ...totals, ...rates },
			agentSends,
			daily,
			perDomain,
			topBounces,
		};
		if (input.isAdmin) {
			stats.perUser = groupBy(msgRows, (r) => r.sender_email)
				.map(({ key: email, ...rest }) => ({ email, ...rest }))
				.sort((a, b) => b.sent - a.sent);
		}
		return stats;
	}
}

export interface DeliveryDayPoint {
	day: string;
	sent: number;
	delivered: number;
	bounced: number;
	complained: number;
}

export interface DeliveryStats {
	rangeDays: number;
	/** The member email when member-scoped, null when team-wide (admin). */
	scopedTo: string | null;
	totals: {
		sent: number;
		delivered: number;
		bounced: number;
		complained: number;
		sendFailed: number;
		queued: number;
	} & DeliveryRates;
	/** Agent (MCP) sends in this scope/range — independent of the origin filter. */
	agentSends: number;
	daily: DeliveryDayPoint[];
	perDomain: { domain: string; sent: number; delivered: number; bounced: number; bounceRate: number }[];
	perUser?: { email: string; sent: number; delivered: number; bounced: number; bounceRate: number; agentSends: number }[];
	topBounces: { recipient: string; count: number }[];
}

function formatBytes(n: number): string {
	if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
	if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(0)} MB`;
	return `${n} bytes`;
}
