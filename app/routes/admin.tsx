// Copyright (c) 2026 Postbox contributors.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/APACHE-2.0

/**
 * Team admin panel — light-first design.
 * Manage team profile (name, domains, branding), members (invites, roles,
 * quotas, usage), and per-mailbox sharing.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router";
import {
	useAddTeamUser,
	useMailboxShares,
	useMe,
	useRemoveTeamUser,
	useSetMailboxShares,
	useTeamProfile,
	useTeamUsers,
	useUpdateTeamProfile,
	useUpdateTeamUser,
} from "~/queries/team";
import { useMailboxes } from "~/queries/mailboxes";
import type { TeamUserWithUsage } from "~/types";

export function meta() {
	return [{ title: "Team admin — Postbox" }];
}

function formatBytes(n: number): string {
	if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
	if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(0)} MB`;
	if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
	return `${n} B`;
}

const ACCENT = "bg-teal-700 hover:bg-teal-800 text-white";

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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<label className="block">
			<span className="text-sm font-medium text-stone-700 block mb-1.5">{label}</span>
			{children}
		</label>
	);
}

const inputCls =
	"w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600";

// ── Team settings ──────────────────────────────────────────────

function TeamSettingsCard() {
	const { data: profile } = useTeamProfile();
	const update = useUpdateTeamProfile();
	const [name, setName] = useState("");
	const [brandName, setBrandName] = useState("");
	const [logoUrl, setLogoUrl] = useState("");
	const [domains, setDomains] = useState("");
	const [saved, setSaved] = useState(false);

	useEffect(() => {
		if (profile) {
			setName(profile.name);
			setBrandName(profile.brandName ?? "");
			setLogoUrl(profile.logoUrl ?? "");
			setDomains(profile.domains.join(", "));
		}
	}, [profile]);

	if (!profile) return null;

	const handleSave = async (e: React.FormEvent) => {
		e.preventDefault();
		setSaved(false);
		await update.mutateAsync({
			name: name.trim() || "My Team",
			brandName: brandName.trim() || null,
			logoUrl: logoUrl.trim() || null,
			domains: domains.split(",").map((d) => d.trim()).filter(Boolean),
		});
		setSaved(true);
		setTimeout(() => setSaved(false), 2500);
	};

	return (
		<Card title="Team" description="Identity, domains, and branding shown across the app.">
			<form onSubmit={handleSave} className="grid gap-4 sm:grid-cols-2">
				<Field label="Team name">
					<input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
				</Field>
				<Field label="Domains (comma-separated)">
					<input className={inputCls} value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="example.com, example.org" />
				</Field>
				<Field label="Brand name (shown in the app header)">
					<input className={inputCls} value={brandName} onChange={(e) => setBrandName(e.target.value)} placeholder="Acme Inc." />
				</Field>
				<Field label="Logo URL">
					<div className="flex items-center gap-3">
						<input className={inputCls} value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://…" />
						{logoUrl.trim() && (
							<img src={logoUrl.trim()} alt="logo preview" className="h-9 w-9 rounded-lg object-contain border border-stone-200 bg-white shrink-0" />
						)}
					</div>
				</Field>
				<div className="sm:col-span-2 flex items-center gap-3">
					<button type="submit" disabled={update.isPending} className={`${ACCENT} rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50`}>
						{update.isPending ? "Saving…" : "Save changes"}
					</button>
					{saved && <span className="text-sm text-teal-700 font-medium">Saved</span>}
				</div>
			</form>
		</Card>
	);
}

// ── Members ────────────────────────────────────────────────────

function QuotaBar({ used, quota, label }: { used: number; quota: number; label: string }) {
	const pct = quota > 0 ? Math.min(100, (used / quota) * 100) : 0;
	const over = quota > 0 && used >= quota;
	return (
		<div className="min-w-[140px]">
			<div className="flex justify-between text-xs text-stone-500 mb-1">
				<span>{label}</span>
				<span className={over ? "text-red-600 font-medium" : ""}>
					{formatBytes(used)} / {formatBytes(quota)}
				</span>
			</div>
			<div className="h-1.5 rounded-full bg-stone-200 overflow-hidden">
				<div className={`h-full rounded-full ${over ? "bg-red-500" : "bg-teal-600"}`} style={{ width: `${pct}%` }} />
			</div>
		</div>
	);
}

function InviteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
	const add = useAddTeamUser();
	const [email, setEmail] = useState("");
	const [displayName, setDisplayName] = useState("");
	const [role, setRole] = useState<"admin" | "member">("member");
	const [storageGb, setStorageGb] = useState("10");
	const [msgsPerDay, setMsgsPerDay] = useState("200");
	const [error, setError] = useState<string | null>(null);

	if (!open) return null;

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError(null);
		try {
			await add.mutateAsync({
				email: email.trim(),
				displayName: displayName.trim() || undefined,
				role,
				storageQuotaBytes: Math.max(1, Math.floor(Number(storageGb) || 10)) * 1024 ** 3,
				messagesPerDay: Math.max(0, Math.floor(Number(msgsPerDay) || 0)),
			});
			setEmail(""); setDisplayName(""); setRole("member"); setStorageGb("10"); setMsgsPerDay("200");
			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to invite member");
		}
	};

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 p-4" onClick={onClose}>
			<div className="bg-white rounded-2xl border border-stone-200 shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
				<h3 className="text-base font-semibold text-stone-900 mb-4">Invite member</h3>
				<form onSubmit={handleSubmit} className="space-y-4">
					{error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
					<Field label="Email">
						<input type="email" required className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@example.com" />
					</Field>
					<Field label="Display name (optional)">
						<input className={inputCls} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Jane" />
					</Field>
					<div className="grid grid-cols-3 gap-3">
						<Field label="Role">
							<select className={inputCls} value={role} onChange={(e) => setRole(e.target.value as "admin" | "member")}>
								<option value="member">Member</option>
								<option value="admin">Admin</option>
							</select>
						</Field>
						<Field label="Storage (GB)">
							<input type="number" min="1" className={inputCls} value={storageGb} onChange={(e) => setStorageGb(e.target.value)} />
						</Field>
						<Field label="Msgs / day">
							<input type="number" min="0" className={inputCls} value={msgsPerDay} onChange={(e) => setMsgsPerDay(e.target.value)} />
						</Field>
					</div>
					<p className="text-xs text-stone-500">
						Invites create the team record. Also add the email to your Cloudflare Access policy — Access remains the sign-in boundary.
					</p>
					<div className="flex justify-end gap-2">
						<button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-stone-700 border border-stone-300 hover:bg-stone-50">Cancel</button>
						<button type="submit" disabled={add.isPending} className={`${ACCENT} rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50`}>
							{add.isPending ? "Inviting…" : "Invite"}
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}

function EditQuotasDialog({ user, onClose }: { user: TeamUserWithUsage; onClose: () => void }) {
	const update = useUpdateTeamUser();
	const [role, setRole] = useState<"admin" | "member">(user.role);
	const [storageGb, setStorageGb] = useState(String(Math.round(user.storageQuotaBytes / 1024 ** 3)));
	const [msgsPerDay, setMsgsPerDay] = useState(String(user.messagesPerDay));
	const [error, setError] = useState<string | null>(null);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError(null);
		try {
			await update.mutateAsync({
				email: user.email,
				data: {
					role,
					storageQuotaBytes: Math.max(1, Math.floor(Number(storageGb) || 10)) * 1024 ** 3,
					messagesPerDay: Math.max(0, Math.floor(Number(msgsPerDay) || 0)),
				},
			});
			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to update");
		}
	};

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 p-4" onClick={onClose}>
			<div className="bg-white rounded-2xl border border-stone-200 shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
				<h3 className="text-base font-semibold text-stone-900 mb-1">Edit {user.email}</h3>
				<p className="text-sm text-stone-500 mb-4">Role and quotas apply immediately.</p>
				<form onSubmit={handleSubmit} className="space-y-4">
					{error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
					<div className="grid grid-cols-3 gap-3">
						<Field label="Role">
							<select className={inputCls} value={role} onChange={(e) => setRole(e.target.value as "admin" | "member")}>
								<option value="member">Member</option>
								<option value="admin">Admin</option>
							</select>
						</Field>
						<Field label="Storage (GB)">
							<input type="number" min="1" className={inputCls} value={storageGb} onChange={(e) => setStorageGb(e.target.value)} />
						</Field>
						<Field label="Msgs / day">
							<input type="number" min="0" className={inputCls} value={msgsPerDay} onChange={(e) => setMsgsPerDay(e.target.value)} />
						</Field>
					</div>
					<div className="flex justify-end gap-2">
						<button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-stone-700 border border-stone-300 hover:bg-stone-50">Cancel</button>
						<button type="submit" disabled={update.isPending} className={`${ACCENT} rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50`}>
							{update.isPending ? "Saving…" : "Save"}
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}

function MembersCard({ meEmail }: { meEmail: string }) {
	const { data: users = [], isLoading } = useTeamUsers();
	const remove = useRemoveTeamUser();
	const [inviteOpen, setInviteOpen] = useState(false);
	const [editing, setEditing] = useState<TeamUserWithUsage | null>(null);
	const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

	return (
		<Card title="Members" description={`${users.length} member${users.length === 1 ? "" : "s"} · usage resets daily for messages, storage accumulates.`}>
			<div className="flex justify-end mb-4">
				<button onClick={() => setInviteOpen(true)} className={`${ACCENT} rounded-lg px-4 py-2 text-sm font-medium transition-colors`}>
					Invite member
				</button>
			</div>
			{isLoading ? (
				<p className="text-sm text-stone-500 py-6 text-center">Loading members…</p>
			) : (
				<div className="overflow-x-auto -mx-6 px-6">
					<table className="w-full text-sm min-w-[640px]">
						<thead>
							<tr className="text-left text-xs uppercase tracking-wide text-stone-400 border-b border-stone-200">
								<th className="pb-2 pr-4 font-medium">Member</th>
								<th className="pb-2 pr-4 font-medium">Role</th>
								<th className="pb-2 pr-4 font-medium">Messages today</th>
								<th className="pb-2 pr-4 font-medium">Storage</th>
								<th className="pb-2 font-medium text-right">Actions</th>
							</tr>
						</thead>
						<tbody>
							{users.map((u) => (
								<tr key={u.email} className="border-b border-stone-100 last:border-0">
									<td className="py-3 pr-4">
										<div className="font-medium text-stone-900">{u.displayName || u.email.split("@")[0]}</div>
										<div className="text-xs text-stone-500">{u.email}</div>
									</td>
									<td className="py-3 pr-4">
										<span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${u.role === "admin" ? "bg-teal-50 text-teal-800 border border-teal-200" : "bg-stone-100 text-stone-600 border border-stone-200"}`}>
											{u.role}
										</span>
									</td>
									<td className="py-3 pr-4">
										<div className="min-w-[140px]">
											<div className="flex justify-between text-xs text-stone-500 mb-1">
												<span>Sent today</span>
												<span className={u.messagesSent >= u.messagesPerDay ? "text-red-600 font-medium" : ""}>
													{u.messagesSent} / {u.messagesPerDay}
												</span>
											</div>
											<div className="h-1.5 rounded-full bg-stone-200 overflow-hidden">
												<div
													className={`h-full rounded-full ${u.messagesSent >= u.messagesPerDay ? "bg-red-500" : "bg-teal-600"}`}
													style={{ width: `${u.messagesPerDay > 0 ? Math.min(100, (u.messagesSent / u.messagesPerDay) * 100) : 0}%` }}
												/>
											</div>
										</div>
									</td>
									<td className="py-3 pr-4">
										<QuotaBar used={u.storageBytes} quota={u.storageQuotaBytes} label="Used" />
									</td>
									<td className="py-3 text-right whitespace-nowrap">
										<button onClick={() => setEditing(u)} className="text-sm font-medium text-teal-700 hover:text-teal-900 mr-3">Edit</button>
										{u.email !== meEmail && (
											confirmRemove === u.email ? (
												<>
													<button
														onClick={() => { remove.mutate(u.email); setConfirmRemove(null); }}
														className="text-sm font-medium text-red-600 hover:text-red-800 mr-2"
													>
														Confirm
													</button>
													<button onClick={() => setConfirmRemove(null)} className="text-sm text-stone-500 hover:text-stone-700">
														Cancel
													</button>
												</>
											) : (
												<button onClick={() => setConfirmRemove(u.email)} className="text-sm font-medium text-stone-400 hover:text-red-600">
													Remove
												</button>
											)
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
			<InviteDialog open={inviteOpen} onClose={() => setInviteOpen(false)} />
			{editing && <EditQuotasDialog user={editing} onClose={() => setEditing(null)} />}
		</Card>
	);
}

// ── Mailbox sharing ────────────────────────────────────────────

function ShareEditor({ mailboxId, mailboxEmail, onClose }: { mailboxId: string; mailboxEmail: string; onClose: () => void }) {
	const { data: shares } = useMailboxShares(mailboxId);
	const { data: users = [] } = useTeamUsers();
	const setShares = useSetMailboxShares();
	const [selected, setSelected] = useState<string[]>([]);
	const [loaded, setLoaded] = useState(false);

	useEffect(() => {
		if (shares && !loaded) {
			setSelected(shares.sharedWith);
			setLoaded(true);
		}
	}, [shares, loaded]);

	const toggle = (email: string) =>
		setSelected((s) => (s.includes(email) ? s.filter((e) => e !== email) : [...s, email]));

	const handleSave = async () => {
		await setShares.mutateAsync({ mailboxId, userEmails: selected });
		onClose();
	};

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 p-4" onClick={onClose}>
			<div className="bg-white rounded-2xl border border-stone-200 shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
				<h3 className="text-base font-semibold text-stone-900 mb-1">Share {mailboxEmail}</h3>
				<p className="text-sm text-stone-500 mb-4">
					Owner: <span className="font-medium text-stone-700">{shares?.owner ?? "—"}</span> · Admins always see every mailbox. With no one selected, all members see it.
				</p>
				<div className="space-y-1 max-h-64 overflow-y-auto mb-5">
					{users.filter((u) => u.role === "member").map((u) => (
						<label key={u.email} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-stone-50 cursor-pointer">
							<input
								type="checkbox"
								checked={selected.includes(u.email)}
								onChange={() => toggle(u.email)}
								className="h-4 w-4 rounded border-stone-300 accent-teal-700"
							/>
							<span className="text-sm text-stone-800">{u.displayName || u.email.split("@")[0]}</span>
							<span className="text-xs text-stone-400">{u.email}</span>
						</label>
					))}
					{users.filter((u) => u.role === "member").length === 0 && (
						<p className="text-sm text-stone-400 px-3 py-2">No members to share with yet.</p>
					)}
				</div>
				<div className="flex justify-end gap-2">
					<button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-stone-700 border border-stone-300 hover:bg-stone-50">Cancel</button>
					<button onClick={handleSave} disabled={setShares.isPending} className={`${ACCENT} rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50`}>
						{setShares.isPending ? "Saving…" : "Save sharing"}
					</button>
				</div>
			</div>
		</div>
	);
}

function MailboxesCard() {
	const { data: mailboxes = [] } = useMailboxes();
	const [sharing, setSharing] = useState<{ id: string; email: string } | null>(null);

	return (
		<Card title="Mailboxes" description="Control which members see each mailbox. New mailboxes are owned by their creator.">
			{mailboxes.length === 0 ? (
				<p className="text-sm text-stone-500 py-4 text-center">No mailboxes yet — create one from the home page.</p>
			) : (
				<ul className="divide-y divide-stone-100">
					{mailboxes.map((m) => (
						<ShareRow key={m.id} mailboxId={m.id} email={m.email} onEdit={() => setSharing({ id: m.id, email: m.email })} />
					))}
				</ul>
			)}
			{sharing && <ShareEditor mailboxId={sharing.id} mailboxEmail={sharing.email} onClose={() => setSharing(null)} />}
		</Card>
	);
}

function ShareRow({ mailboxId, email, onEdit }: { mailboxId: string; email: string; onEdit: () => void }) {
	const { data: shares } = useMailboxShares(mailboxId);
	const label = !shares ? "…" : shares.sharedWith.length === 0 ? "Visible to all members" : `Shared with ${shares.sharedWith.length} member${shares.sharedWith.length === 1 ? "" : "s"}`;
	return (
		<li className="flex items-center gap-4 py-3">
			<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal-50 text-sm font-bold text-teal-800 border border-teal-100">
				{email.charAt(0).toUpperCase()}
			</div>
			<div className="min-w-0 flex-1">
				<div className="text-sm font-medium text-stone-900 truncate">{email}</div>
				<div className="text-xs text-stone-500">{label}{shares?.owner ? ` · owner: ${shares.owner}` : ""}</div>
			</div>
			<button onClick={onEdit} className="text-sm font-medium text-teal-700 hover:text-teal-900 shrink-0">Sharing</button>
		</li>
	);
}

// ── Page ───────────────────────────────────────────────────────

export default function AdminRoute() {
	const { data: me, isLoading, isError } = useMe();

	return (
		<div className="min-h-screen bg-[#FAF7F2] text-stone-900">
			<header className="border-b border-stone-200 bg-white/80 backdrop-blur sticky top-0 z-10">
				<div className="mx-auto max-w-5xl px-4 sm:px-6 py-4 flex items-center gap-3">
					<Link to="/" className="text-sm font-medium text-stone-500 hover:text-stone-800">← Mailboxes</Link>
					<h1 className="text-xl font-bold text-stone-900 ml-2">Team admin</h1>
				</div>
			</header>
			<main className="mx-auto max-w-5xl px-4 sm:px-6 py-8 space-y-6">
				{isLoading ? (
					<p className="text-sm text-stone-500 py-16 text-center">Loading…</p>
				) : isError || !me ? (
					<div className="bg-white rounded-2xl border border-stone-200 p-10 text-center">
						<h2 className="text-lg font-semibold mb-2">Could not load team info</h2>
						<p className="text-sm text-stone-500">Your session may have expired. Try reloading.</p>
					</div>
				) : me.role !== "admin" ? (
					<div className="bg-white rounded-2xl border border-stone-200 p-10 text-center">
						<h2 className="text-lg font-semibold mb-2">Admin only</h2>
						<p className="text-sm text-stone-500">This area is restricted to team admins.</p>
						<Link to="/" className="inline-block mt-4 text-sm font-medium text-teal-700 hover:text-teal-900">← Back to mailboxes</Link>
					</div>
				) : (
					<>
						<TeamSettingsCard />
						<MembersCard meEmail={me.email} />
						<MailboxesCard />
						<Card title="Delivery analytics" description="Outbound delivery tracking: queued → sent → delivered / bounced / complained, with per-domain and per-sender stats.">
							<Link
								to="/delivery"
								className="inline-block rounded-lg px-4 py-2 text-sm font-medium bg-teal-700 hover:bg-teal-800 text-white transition-colors"
							>
								Open delivery analytics →
							</Link>
						</Card>
					</>
				)}
			</main>
		</div>
	);
}
