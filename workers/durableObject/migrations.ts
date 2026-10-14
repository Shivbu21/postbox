// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

export interface Migration {
	name: string;
	sql: string;
}

/**
 * Minimal migration runner that replaces workers-qb's DOQB.migrations().apply().
 *
 * Uses the `d1_migrations` tracking table for backward compatibility with
 * existing deployments that were managed by workers-qb. New deployments
 * create the same table so the schema is consistent either way.
 */
export function applyMigrations(
	sql: SqlStorage,
	migrations: Migration[],
	storage?: DurableObjectStorage,
): void {
	sql.exec(`CREATE TABLE IF NOT EXISTS d1_migrations (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL UNIQUE,
		applied_at TEXT NOT NULL DEFAULT (datetime('now'))
	)`);

	for (const migration of migrations) {
		const applied = [
			...sql.exec(
				`SELECT 1 FROM d1_migrations WHERE name = ?`,
				migration.name,
			),
		];
		if (applied.length > 0) continue;

		// Strip any existing BEGIN/COMMIT wrapper from the migration SQL.
		// Cloudflare's DO runtime forbids SQL-level transactions -- must use
		// the JS storage.transactionSync() API instead.
		let migrationSql = migration.sql.trim();
		migrationSql = migrationSql.replace(/^\s*BEGIN\s+TRANSACTION\s*;?\s*/i, "");
		migrationSql = migrationSql.replace(/\s*COMMIT\s*;?\s*$/i, "");

		const escapedName = migration.name.replace(/'/g, "''");
		const run = () => {
			sql.exec(migrationSql);
			sql.exec(
				`INSERT INTO d1_migrations (name) VALUES ('${escapedName}')`,
			);
		};

		if (storage) {
			// Preferred: atomic transaction via the DO JS API
			storage.transactionSync(run);
		} else {
			// Fallback: run without explicit transaction (each exec is auto-committed)
			run();
		}
	}
}

interface DurableObjectStorage {
	transactionSync: <T>(closure: () => T) => T;
}

/**
 * Wrap SQL in a transaction so multi-statement migrations are atomic.
 *
 * Without this, a migration like `1_initial_setup` (CREATE + INSERT +
 * CREATE + CREATE) could fail mid-way and leave the database in an
 * inconsistent state that the runner considers "applied" but is
 * actually broken.  SQLite transactions guarantee all-or-nothing.
 *
 * Single-statement migrations don't strictly need it but wrapping
 * uniformly costs nothing and avoids accidental omissions.
 */
function txn(sql: string): string {
	const trimmed = sql.trim();
	// Don't double-wrap if someone already added BEGIN/COMMIT
	if (/^\s*BEGIN\b/i.test(trimmed)) return trimmed;
	return `BEGIN TRANSACTION;\n${trimmed}\nCOMMIT;`;
}

export const mailboxMigrations: Migration[] = [
	{
		name: "1_initial_setup",
		sql: txn(`
            CREATE TABLE folders (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                is_deletable INTEGER NOT NULL DEFAULT 1
            );

            INSERT INTO folders (id, name, is_deletable) VALUES
                ('inbox', 'Inbox', 0),
                ('sent', 'Sent', 0),
                ('trash', 'Trash', 0),
                ('archive', 'Archive', 0),
                ('spam', 'Spam', 0);

            CREATE TABLE emails (
                id TEXT PRIMARY KEY,
                folder_id TEXT NOT NULL,
                subject TEXT,
                sender TEXT,
                recipient TEXT,
                date TEXT,
                read INTEGER DEFAULT 0,
                starred INTEGER DEFAULT 0,
                body TEXT,
                FOREIGN KEY(folder_id) REFERENCES folders(id) ON DELETE CASCADE
            );

            CREATE TABLE attachments (
                id TEXT PRIMARY KEY,
                email_id TEXT NOT NULL,
                filename TEXT NOT NULL,
                mimetype TEXT NOT NULL,
                size INTEGER NOT NULL,
                content_id TEXT,
                disposition TEXT,
                FOREIGN KEY(email_id) REFERENCES emails(id) ON DELETE CASCADE
            );
        `),
	},
	{
		name: "2_add_email_threading",
		sql: txn(`
            ALTER TABLE emails ADD COLUMN in_reply_to TEXT;
            ALTER TABLE emails ADD COLUMN email_references TEXT;
            ALTER TABLE emails ADD COLUMN thread_id TEXT;

            CREATE INDEX idx_emails_thread_id ON emails(thread_id);
            CREATE INDEX idx_emails_in_reply_to ON emails(in_reply_to);
        `),
	},
	{
		name: "3_add_draft_folder",
		sql: txn(`INSERT INTO folders (id, name, is_deletable) VALUES ('draft', 'Drafts', 0);`),
	},
	{
		name: "4_add_message_id",
		sql: txn(`ALTER TABLE emails ADD COLUMN message_id TEXT;`),
	},
	{
		name: "5_add_raw_headers",
		sql: txn(`ALTER TABLE emails ADD COLUMN raw_headers TEXT;`),
	},
	{
		name: "6_mark_sent_emails_as_read",
		sql: txn(`UPDATE emails SET read = 1 WHERE folder_id = 'sent' AND read = 0;`),
	},
	{
		name: "7_add_cc_bcc",
		sql: txn(`
            ALTER TABLE emails ADD COLUMN cc TEXT;
            ALTER TABLE emails ADD COLUMN bcc TEXT;
        `),
	},
	{
		// No txn() wrapper: Cloudflare's DO runtime requires state.storage.transactionSync()
		// instead of SQL-level BEGIN TRANSACTION. These are idempotent CREATE INDEX IF NOT EXISTS
		// statements so they're safe to run without a transaction.
		name: "8_add_folder_date_indexes",
		sql: `
            CREATE INDEX IF NOT EXISTS idx_emails_folder_id ON emails(folder_id);
            CREATE INDEX IF NOT EXISTS idx_emails_date ON emails(date);
            CREATE INDEX IF NOT EXISTS idx_emails_folder_date ON emails(folder_id, date DESC);
        `,
	},
];

/**
 * Team layer migrations for the TeamDO Durable Object (separate SQLite
 * database from the per-mailbox MailboxDO). Applied once per deployment.
 */
export const teamMigrations: Migration[] = [
	{
		name: "team_1_initial_setup",
		sql: txn(`
            CREATE TABLE team_profile (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL DEFAULT 'My Team',
                domains TEXT NOT NULL DEFAULT '[]',
                brand_name TEXT,
                logo_url TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE team_users (
                email TEXT PRIMARY KEY,
                display_name TEXT,
                role TEXT NOT NULL DEFAULT 'member',
                storage_quota_bytes INTEGER NOT NULL DEFAULT 10737418240,
                messages_per_day INTEGER NOT NULL DEFAULT 200,
                created_at TEXT NOT NULL
            );

            CREATE TABLE team_usage (
                user_email TEXT PRIMARY KEY,
                quota_day TEXT NOT NULL,
                messages_sent INTEGER NOT NULL DEFAULT 0,
                storage_bytes INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE mailbox_shares (
                mailbox_id TEXT NOT NULL,
                user_email TEXT NOT NULL,
                is_owner INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (mailbox_id, user_email)
            );

            CREATE INDEX IF NOT EXISTS idx_mailbox_shares_user ON mailbox_shares(user_email);
        `),
	},
	{
		name: "team_2_delivery_tracking",
		sql: txn(`
            CREATE TABLE delivery_messages (
                message_id TEXT PRIMARY KEY,
                provider_message_id TEXT,
                sender_email TEXT NOT NULL,
                mailbox_id TEXT NOT NULL,
                domain TEXT NOT NULL,
                subject TEXT NOT NULL DEFAULT '',
                recipient_count INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'queued',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE delivery_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                message_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                recipient TEXT,
                provider_event_id TEXT,
                detail TEXT,
                created_at TEXT NOT NULL
            );

            CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_events_provider_event
                ON delivery_events(provider_event_id);
            CREATE INDEX IF NOT EXISTS idx_delivery_events_message
                ON delivery_events(message_id);
            CREATE INDEX IF NOT EXISTS idx_delivery_messages_sender
                ON delivery_messages(sender_email);
            CREATE INDEX IF NOT EXISTS idx_delivery_messages_domain
                ON delivery_messages(domain);
            CREATE INDEX IF NOT EXISTS idx_delivery_messages_created
                ON delivery_messages(created_at);
        `),
	},
	{
		name: "team_3_agent_origin",
		sql: txn(`
            -- Module 3: attribute agent (MCP) sends separately from human (UI) sends.
            -- Existing rows backfill to 'human'.
            ALTER TABLE delivery_messages
                ADD COLUMN origin TEXT NOT NULL DEFAULT 'human';
            CREATE INDEX IF NOT EXISTS idx_delivery_messages_origin
                ON delivery_messages(origin);
        `),
	},
];
