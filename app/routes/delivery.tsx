// Copyright (c) 2026 Postbox contributors.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/APACHE-2.0

/**
 * Delivery analytics — light-first design matching the team admin panel.
 * Admins see team-wide stats plus per-user breakdowns; members see only
 * their own sends (enforced by the API).
 */
import { useState } from "react";
import { Link } from "react-router";
import { useDeliveryStats } from "~/queries/delivery";
import { useMe } from "~/queries/team";
import type { DeliveryStats, DeliveryOriginFilter } from "~/types";

export function meta() {
	return [{ title: "Delivery analytics — Postbox" }];
}

const inputCls =
	"rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600";

function Card({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
	return (
		<section className="bg-white rounded-2xl border border-stone-200 shadow-[0_1px_2px_rgba(28,25,23,0.05)] p-6">
			<h2 className="text-lg font-semibold text-stone-900">{title}</h2>
			{description && <p className="text-sm text-stone-500 mt-1 mb-5">{description}</p>}
			{!description && <div className="mb-5" />}
			{children}
		</section>
	);
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "ok" | "warn" | "bad" }) {
	const toneCls = tone === "bad" ? "text-red-700" : tone === "warn" ? "text-amber-700" : "text-stone-900";
	return (
		<div className="bg-white rounded-2xl border border-stone-200 p-5">
			<div className="text-xs font-medium uppercase tracking-wide text-stone-400">{label}</div>
			<div className={`text-3xl font-bold mt-1 ${toneCls}`}>{value}</div>
			{sub && <div className="text-xs text-stone-500 mt-1">{sub}</div>}
		</div>
	);
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

/** Minimal SVG bar chart: daily sent (teal) with bounced overlay (red). */
function VolumeChart({ stats }: { stats: DeliveryStats }) {
	const W = 640;
	const H = 180;
	const pad = 28;
	const max = Math.max(1, ...stats.daily.map((d) => d.sent));
	const n = stats.daily.length;
	const bw = (W - pad * 2) / n;
	return (
		<svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Daily send volume">
			{stats.daily.map((d, i) => {
				const x = pad + i * bw + bw * 0.15;
				const w = bw * 0.7;
				const sentH = (d.sent / max) * (H - pad * 2);
				const bounceH = (d.bounced / max) * (H - pad * 2);
				return (
					<g key={d.day}>
						<title>{`${d.day}: ${d.sent} sent, ${d.delivered} delivered, ${d.bounced} bounced`}</title>
						<rect x={x} y={H - pad - sentH} width={w} height={sentH} rx={2} className="fill-teal-600/80" />
						{bounceH > 0 && (
							<rect x={x} y={H - pad - bounceH} width={w} height={bounceH} rx={2} className="fill-red-500" />
						)}
						{i % Math.ceil(n / 7) === 0 && (
							<text x={x + w / 2} y={H - 8} textAnchor="middle" className="fill-stone-400" fontSize={10}>
								{d.day.slice(5)}
							</text>
						)}
					</g>
				);
			})}
		</svg>
	);
}

function RateTable({
	rows,
	columns,
}: {
	rows: { key: string; label: string; sub?: string; sent: number; delivered: number; bounced: number; bounceRate: number; agentSends?: number }[];
	columns: { key: string; label: string };
}) {
	if (rows.length === 0) return <p className="text-sm text-stone-400 py-4 text-center">No data in this range.</p>;
	const showAgent = rows.some((r) => r.agentSends !== undefined);
	return (
		<div className="overflow-x-auto -mx-6 px-6">
			<table className="w-full text-sm min-w-[520px]">
				<thead>
					<tr className="text-left text-xs uppercase tracking-wide text-stone-400 border-b border-stone-200">
						<th className="pb-2 pr-4 font-medium">{columns.label}</th>
						<th className="pb-2 pr-4 font-medium text-right">Sent</th>
						<th className="pb-2 pr-4 font-medium text-right">Delivered</th>
						<th className="pb-2 pr-4 font-medium text-right">Bounced</th>
						{showAgent && <th className="pb-2 pr-4 font-medium text-right">AI agent</th>}
						<th className="pb-2 font-medium text-right">Bounce rate</th>
					</tr>
				</thead>
				<tbody>
					{rows.map((r) => (
						<tr key={r.key} className="border-b border-stone-100 last:border-0">
							<td className="py-2.5 pr-4">
								<div className="font-medium text-stone-900 truncate max-w-[240px]">{r.label}</div>
								{r.sub && <div className="text-xs text-stone-400">{r.sub}</div>}
							</td>
							<td className="py-2.5 pr-4 text-right tabular-nums text-stone-700">{r.sent}</td>
							<td className="py-2.5 pr-4 text-right tabular-nums text-stone-700">{r.delivered}</td>
							<td className={`py-2.5 pr-4 text-right tabular-nums ${r.bounced > 0 ? "text-red-600 font-medium" : "text-stone-700"}`}>{r.bounced}</td>
							{showAgent && (
								<td className={`py-2.5 pr-4 text-right tabular-nums ${r.agentSends! > 0 ? "text-teal-700 font-medium" : "text-stone-700"}`}>{r.agentSends}</td>
							)}
							<td className={`py-2.5 text-right tabular-nums ${r.bounceRate >= 0.05 ? "text-red-600 font-medium" : "text-stone-700"}`}>
								{pct(r.bounceRate)}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

export default function DeliveryRoute() {
	const { data: me } = useMe();
	const [days, setDays] = useState<7 | 30>(7);
	const [domainInput, setDomainInput] = useState("");
	const [domain, setDomain] = useState<string | undefined>(undefined);
	const [origin, setOrigin] = useState<DeliveryOriginFilter>("all");
	const { data: stats, isLoading, isError } = useDeliveryStats(days, domain, origin);

	const applyDomain = (e: React.FormEvent) => {
		e.preventDefault();
		setDomain(domainInput.trim().toLowerCase() || undefined);
	};

	const originPills: { value: DeliveryOriginFilter; label: string }[] = [
		{ value: "all", label: "All" },
		{ value: "human", label: "Human" },
		{ value: "agent", label: "AI agent" },
	];
	const pillCls = (active: boolean) =>
		`rounded-lg px-3 py-1.5 text-sm font-medium border transition-colors ${
			active
				? "bg-teal-700 border-teal-700 text-white"
				: "bg-white border-stone-300 text-stone-600 hover:bg-stone-50"
		}`;

	return (
		<div className="min-h-screen bg-[#FAF7F2] text-stone-900">
			<header className="border-b border-stone-200 bg-white/80 backdrop-blur sticky top-0 z-10">
				<div className="mx-auto max-w-5xl px-4 sm:px-6 py-4 flex items-center gap-3">
					<Link to="/" className="text-sm font-medium text-stone-500 hover:text-stone-800">← Mailboxes</Link>
					<h1 className="text-xl font-bold text-stone-900 ml-2">Delivery analytics</h1>
					<div className="ml-auto flex items-center gap-2">
						{originPills.map((p) => (
							<button key={p.value} onClick={() => setOrigin(p.value)} className={pillCls(origin === p.value)}>
								{p.label}
							</button>
						))}
						<span className="w-px h-5 bg-stone-200 mx-1" aria-hidden />
						{[7, 30].map((d) => (
							<button
								key={d}
								onClick={() => setDays(d as 7 | 30)}
								className={pillCls(days === d)}
							>
								{d}d
							</button>
						))}
					</div>
				</div>
			</header>
			<main className="mx-auto max-w-5xl px-4 sm:px-6 py-8 space-y-6">
				{isLoading ? (
					<p className="text-sm text-stone-500 py-16 text-center">Loading delivery stats…</p>
				) : isError || !stats ? (
					<div className="bg-white rounded-2xl border border-stone-200 p-10 text-center">
						<h2 className="text-lg font-semibold mb-2">Could not load delivery stats</h2>
						<p className="text-sm text-stone-500">Try reloading the page.</p>
					</div>
				) : (
					<>
						{stats.scopedTo && (
							<p className="text-sm text-stone-500">
								Showing your own sends <span className="font-medium text-stone-700">{stats.scopedTo}</span>. Admins see the whole team.
							</p>
						)}
						<div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
							<Stat label="Sent" value={String(stats.totals.sent)} sub={`last ${stats.rangeDays} days`} />
							<Stat label="Delivered" value={pct(stats.totals.deliveryRate)} sub={`${stats.totals.delivered} messages`} tone="ok" />
							<Stat
								label="Bounced"
								value={pct(stats.totals.bounceRate)}
								sub={`${stats.totals.bounced} messages`}
								tone={stats.totals.bounceRate >= 0.05 ? "bad" : undefined}
							/>
							<Stat
								label="Complaints"
								value={pct(stats.totals.complaintRate)}
								sub={`${stats.totals.complained} messages`}
								tone={stats.totals.complained > 0 ? "warn" : undefined}
							/>
							<Stat
								label="AI agent sends"
								value={String(stats.agentSends)}
								sub={stats.totals.sent > 0 ? `${pct(stats.agentSends / stats.totals.sent)} of volume` : "no sends in range"}
							/>
						</div>
						{(stats.totals.sendFailed > 0 || stats.totals.queued > 0) && (
							<p className="text-sm text-stone-500">
								{stats.totals.sendFailed > 0 && <span className="text-red-600 font-medium">{stats.totals.sendFailed} failed to send. </span>}
								{stats.totals.queued > 0 && <span>{stats.totals.queued} still queued.</span>}
							</p>
						)}
						<Card title="Volume" description="Messages sent per day (teal); bounces overlaid in red.">
							<VolumeChart stats={stats} />
						</Card>
						<Card
							title="By domain"
							description="Filter the whole page to one sending domain."
						>
							<form onSubmit={applyDomain} className="flex gap-2 mb-4">
								<input
									className={inputCls}
									value={domainInput}
									onChange={(e) => setDomainInput(e.target.value)}
									placeholder="example.com"
								/>
								<button type="submit" className="rounded-lg px-4 py-2 text-sm font-medium bg-teal-700 hover:bg-teal-800 text-white">
									Filter
								</button>
								{domain && (
									<button
										type="button"
										onClick={() => { setDomain(undefined); setDomainInput(""); }}
										className="rounded-lg px-4 py-2 text-sm font-medium text-stone-600 border border-stone-300 hover:bg-stone-50"
									>
										Clear
									</button>
								)}
							</form>
							<RateTable
								columns={{ key: "domain", label: "Domain" }}
								rows={stats.perDomain.map((d) => ({ key: d.domain, label: d.domain, ...d }))}
							/>
						</Card>
						{stats.perUser && (
							<Card title="By sender" description="Per-member breakdown (admin only).">
								<RateTable
									columns={{ key: "email", label: "Sender" }}
									rows={stats.perUser.map((u) => ({ key: u.email, label: u.email, ...u }))}
								/>
							</Card>
						)}
						<Card title="Top bouncing recipients" description="Addresses that bounced most in this range — clean these from your lists.">
							{stats.topBounces.length === 0 ? (
								<p className="text-sm text-stone-400 py-4 text-center">No bounces recorded. Nice.</p>
							) : (
								<ul className="divide-y divide-stone-100">
									{stats.topBounces.map((b) => (
										<li key={b.recipient} className="flex items-center justify-between py-2.5">
											<span className="text-sm text-stone-800 truncate">{b.recipient}</span>
											<span className="text-sm font-medium text-red-600 tabular-nums">{b.count} bounce{b.count === 1 ? "" : "s"}</span>
										</li>
									))}
								</ul>
							)}
						</Card>
						{!me || me.role === "admin" ? (
							<Card
								title="Provider webhooks"
								description="Cloudflare's Email Service does not emit delivery/bounce callbacks, so delivered / bounced / complained states arrive only if you wire a provider webhook. Point it here:"
							>
								<code className="block text-xs bg-stone-100 border border-stone-200 rounded-lg px-3 py-2.5 text-stone-700 break-all">
									POST /api/v1/delivery/webhook
								</code>
								<p className="text-xs text-stone-500 mt-3">
									Header <code className="bg-stone-100 px-1 rounded">x-delivery-secret</code> must match{" "}
									<code className="bg-stone-100 px-1 rounded">DELIVERY_WEBHOOK_SECRET</code>. Retried
									webhooks dedup on <code className="bg-stone-100 px-1 rounded">provider_event_id</code>.
									Until then, tracking covers queued → sent → send_failed from the send binding itself.
								</p>
							</Card>
						) : null}
					</>
				)}
			</main>
		</div>
	);
}
