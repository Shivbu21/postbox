# postbox 1.0.0 — Release Notes

**Build date:** 2026-10-14
**License:** Apache-2.0 (see LICENSE; fork of cloudflare/agentic-inbox with attribution)
**Codename:** postbox (working name — not final branding)

## What it is

An open-source team business-email kit running entirely on Cloudflare Workers —
a Google Workspace-style alternative for small teams: team workspaces, member
invites with roles, per-user send/storage quotas, per-user inbox views over
shared domains, delivery analytics, and an AI email agent — all on your own
Cloudflare account.

## Verified this release

- `npx tsc -b` — clean (exit 0)
- `npm run build` — succeeds (client + SSR, ~23s)
- `npm test` (vitest) — **26/26 pass** (15 delivery state-machine + 11 agent-identity)

## Modules included

1. **Team layer** — TeamDO Durable Object (team profile, domains, branding,
   members/roles, per-user quotas), `/admin` panel, REST API under `/api/v1/team`,
   Cloudflare Access JWT identity (production) / `DEV_USER_EMAIL` (dev)
2. **Delivery tracking + analytics** — every send tracked
   (queued → sent / send_failed), `/delivery` analytics page (rates, volume chart,
   per-domain/per-sender tables, 7/30-day picker), provider webhook endpoint ready
   for SES/SendGrid/Postmark
3. **AI-agent send tracking** — agent (MCP) sends attributed to the invoking team
   member via per-session identity, quota-enforced, tracked with `origin: agent`,
   shown separately in analytics

## Run it

```bash
cd postbox-1.0.0
npm install
# set DOMAINS in wrangler.jsonc, create R2 bucket, then:
npm run dev
```

Deploy: `npx wrangler deploy` (see README.md Setup + wrangler.jsonc)

## Going live — required

- A **Cloudflare account** (Workers, R2, D1/DO, Email Routing + Email Sending)
- **Cloudflare Access** policy covering the app (production auth)
- Your sending domain's DNS on Cloudflare (Email Routing)

## Honest limitations

- `delivered` / `bounced` / `complained` / `opened` states are **stubbed** —
  Cloudflare's Email Service binding emits no delivery callbacks; the webhook
  endpoint, state machine, dedup, and analytics are ready for a real provider
  adapter (SES/SendGrid/Postmark)
- Needs a live Cloudflare account + Access policy to verify the real MCP
  handshake and per-session agent identity (verified from SDK source, not a live run)
- If the `agents` SDK changes its header-forwarding plumbing, agent attribution
  degrades to the mailbox-owner fallback (flagged as an upgrade smoke-test)
- Invited users must also be added to the Cloudflare Access policy
