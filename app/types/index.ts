// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

export interface SignatureSettings {
	enabled: boolean;
	text: string;
	html?: string;
}

export interface MailboxSettings {
	fromName?: string;
	forwarding?: { enabled: boolean; email: string };
	signature?: SignatureSettings;
	autoReply?: { enabled: boolean; subject: string; message: string };
	agentSystemPrompt?: string;
}

export interface Mailbox {
	id: string;
	email: string;
	name: string;
	settings?: MailboxSettings;
}

export interface Email {
	id: string;
	thread_id?: string | null;
	folder_id?: string | null;
	subject: string;
	sender: string;
	recipient: string;
	cc?: string;
	bcc?: string;
	date: string;
	read: boolean;
	starred: boolean;
	body?: string | null;
	in_reply_to?: string | null;
	email_references?: string | null;
	message_id?: string | null;
	raw_headers?: string | null;
	attachments?: Attachment[];
	snippet?: string | null;
	// Thread aggregate fields (only present in threaded list view)
	thread_count?: number;
	thread_unread_count?: number;
	participants?: string;
	needs_reply?: boolean;
	has_draft?: boolean;
}

export interface Attachment {
	id: string;
	filename: string;
	mimetype: string;
	size: number;
	content_id?: string;
	disposition?: string;
}

export interface Folder {
	id: string;
	name: string;
	unreadCount: number;
}

// ── Team layer (Postbox) ───────────────────────────────────────────

export interface TeamProfile {
	id: string;
	name: string;
	domains: string[];
	brandName: string | null;
	logoUrl: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface TeamUser {
	email: string;
	displayName: string | null;
	role: "admin" | "member";
	storageQuotaBytes: number;
	messagesPerDay: number;
	createdAt: string;
}

export interface TeamUserWithUsage extends TeamUser {
	quotaDay: string;
	messagesSent: number;
	storageBytes: number;
}

export interface TeamMe extends TeamUser {
	messagesSentToday: number;
	storageBytesUsed: number;
}

export interface MailboxShares {
	owner: string | null;
	sharedWith: string[];
}

export interface DeliveryDayPoint {
	day: string;
	sent: number;
	delivered: number;
	bounced: number;
	complained: number;
}

export interface DeliveryTotals {
	sent: number;
	delivered: number;
	bounced: number;
	complained: number;
	sendFailed: number;
	queued: number;
	deliveryRate: number;
	bounceRate: number;
	complaintRate: number;
}

export interface DeliveryStats {
	rangeDays: number;
	/** The member email when member-scoped, null when team-wide (admin). */
	scopedTo: string | null;
	totals: DeliveryTotals;
	/** Agent (MCP) sends in this scope/range — independent of the origin filter. */
	agentSends: number;
	daily: DeliveryDayPoint[];
	perDomain: { domain: string; sent: number; delivered: number; bounced: number; bounceRate: number }[];
	perUser?: { email: string; sent: number; delivered: number; bounced: number; bounceRate: number; agentSends: number }[];
	topBounces: { recipient: string; count: number }[];
}

export type DeliveryOriginFilter = "all" | "human" | "agent";
