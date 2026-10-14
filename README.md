<div align="center">
  <h1>Postbox</h1>
  <p><em>An open-source team business-email kit running entirely on Cloudflare Workers</em></p>
</div>

Postbox is a self-hosted, multi-user email platform for teams — send, receive, and manage email across shared domains through a modern web interface, all powered by your own Cloudflare account. It is a fork of Cloudflare's [agentic-inbox](https://github.com/cloudflare/agentic-inbox) template (Apache-2.0), extended with a **team layer** that turns the single-user template into a small-business email suite: team workspaces, member invites, per-user quotas, per-user inbox views over shared domains, and an admin panel.

## What Postbox adds over the template

- **Team workspace** — one team per deployment with multiple domains, custom branding (name + logo)
- **Members & roles** — invite members, assign `admin` / `member` roles
- **Per-user quotas** — daily send limits and storage quotas, enforced at send time, visible to admins
- **Per-user inbox views** — members see shared inboxes plus the mailboxes explicitly shared with them; admins see everything
- **Admin panel** (`/admin`) — manage domains, users, quotas, and branding

Everything from the template keeps working: inbound email via Email Routing, the per-mailbox Durable Object inbox, R2 attachments, compose/reply/forward, folders, search, and the AI email agent.

## Stack

- **Frontend:** React 19, React Router v7, Tailwind CSS, Zustand, TipTap, `@cloudflare/kumo`
- **Backend:** Hono, Cloudflare Workers, Durable Objects (SQLite), R2, Email Routing
- **Team state:** a dedicated `TeamDO` Durable Object (SQLite) holding the team profile, users, quotas/usage, and mailbox shares
- **AI Agent:** Cloudflare Agents SDK, Workers AI
- **Auth:** Cloudflare Access JWT validation in production (required); `DEV_USER_EMAIL` in local development

## Setup

1. Set your domains in `wrangler.jsonc` (`DOMAINS`, comma-separated for more than one)
2. Create the R2 bucket: `npx wrangler r2 bucket create postbox`
3. `npm install && npm run dev`
4. In production: enable one-click Cloudflare Access on the Worker and set the `POLICY_AUD` and `TEAM_DOMAIN` secrets; create a catch-all Email Routing rule pointing at the Worker; enable Email Service (`send_email` binding).

The first authenticated user to open the app becomes the team admin automatically (bootstrap). Admins then invite members from `/admin`. Note: invites create the team record — the Cloudflare Access policy remains the authentication boundary, so also add each member's email to your Access policy.

See [MODULE1.md](./MODULE1.md) for the team layer's design, API, and configuration reference.

## License

Apache-2.0 — see [LICENSE](./LICENSE). Forked from Cloudflare's agentic-inbox; all original copyright notices retained.
