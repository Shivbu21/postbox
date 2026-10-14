// Copyright (c) 2026 Postbox contributors.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/APACHE-2.0

/**
 * Team layer schema — lives in the TeamDO Durable Object's SQLite database.
 * One TeamDO instance ("team") per deployment.
 */
import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";

/** Singleton row (id = 'team'): workspace name, domains, branding. */
export const teamProfile = sqliteTable("team_profile", {
	id: text("id").primaryKey(),
	name: text("name").notNull().default("My Team"),
	domains: text("domains").notNull().default("[]"), // JSON array of domain strings
	brandName: text("brand_name"),
	logoUrl: text("logo_url"),
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull(),
});

/** Team members. Identity comes from Cloudflare Access (email claim). */
export const teamUsers = sqliteTable("team_users", {
	email: text("email").primaryKey(),
	displayName: text("display_name"),
	role: text("role").notNull().default("member"), // 'admin' | 'member'
	storageQuotaBytes: integer("storage_quota_bytes").notNull().default(10 * 1024 * 1024 * 1024), // 10 GB
	messagesPerDay: integer("messages_per_day").notNull().default(200),
	createdAt: text("created_at").notNull(),
});

/** Per-user usage counters. quotaDay resets the daily message counter. */
export const teamUsage = sqliteTable("team_usage", {
	userEmail: text("user_email").primaryKey(),
	quotaDay: text("quota_day").notNull(),
	messagesSent: integer("messages_sent").notNull().default(0),
	storageBytes: integer("storage_bytes").notNull().default(0),
});

/**
 * Which users may see which mailbox.
 * Convention: if a mailbox has NO share rows at all, every team member
 * sees it (matches the template's open behavior). Once shares exist,
 * only listed users (and admins) see it. The creator is recorded with
 * isOwner = 1.
 */
export const mailboxShares = sqliteTable("mailbox_shares", {
	mailboxId: text("mailbox_id").notNull(),
	userEmail: text("user_email").notNull(),
	isOwner: integer("is_owner").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.mailboxId, t.userEmail] })]);

/**
 * Outbound delivery tracking (Module 2): one row per message handed to
 * the send binding. `status` is maintained by the delivery state machine
 * in workers/lib/delivery.ts as events arrive.
 */
export const deliveryMessages = sqliteTable("delivery_messages", {
	messageId: text("message_id").primaryKey(), // internal id (same as the MailboxDO email id)
	providerMessageId: text("provider_message_id"), // returned by the send binding on success
	senderEmail: text("sender_email").notNull(),
	mailboxId: text("mailbox_id").notNull(),
	domain: text("domain").notNull(), // from-domain, lowercased
	subject: text("subject").notNull().default(""),
	recipientCount: integer("recipient_count").notNull().default(0),
	status: text("status").notNull().default("queued"), // DeliveryStatus
	origin: text("origin").notNull().default("human"), // DeliveryOrigin: "human" (UI) | "agent" (MCP)
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull(),
});

/**
 * Append-only delivery event log. `providerEventId` carries a UNIQUE
 * index so retried provider webhooks dedup harmlessly (NULLs don't
 * collide in SQLite, so internal events without one are unaffected).
 */
export const deliveryEvents = sqliteTable("delivery_events", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	messageId: text("message_id").notNull(),
	eventType: text("event_type").notNull(), // DeliveryEventType
	recipient: text("recipient"), // per-recipient for bounce/complaint
	providerEventId: text("provider_event_id"),
	detail: text("detail"), // JSON blob
	createdAt: text("created_at").notNull(),
});
