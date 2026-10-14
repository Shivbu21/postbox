// Copyright (c) 2026 Postbox contributors.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/APACHE-2.0

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "~/services/api";
import type { TeamMe, TeamProfile, TeamUser, TeamUserWithUsage, MailboxShares } from "~/types";
import { queryKeys } from "./keys";

export function useMe() {
	return useQuery<TeamMe>({
		queryKey: queryKeys.team.me,
		queryFn: () => api.getMe(),
		staleTime: 60_000,
	});
}

export function useTeamProfile() {
	return useQuery<TeamProfile>({
		queryKey: queryKeys.team.profile,
		queryFn: () => api.getTeamProfile(),
		staleTime: 60_000,
	});
}

export function useUpdateTeamProfile() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (data: { name?: string; domains?: string[]; brandName?: string | null; logoUrl?: string | null }) =>
			api.updateTeamProfile(data),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: queryKeys.team.profile });
		},
	});
}

export function useTeamUsers() {
	return useQuery<TeamUserWithUsage[]>({
		queryKey: queryKeys.team.users,
		queryFn: () => api.listTeamUsers(),
	});
}

export function useAddTeamUser() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (data: { email: string; displayName?: string; role?: "admin" | "member"; storageQuotaBytes?: number; messagesPerDay?: number }) =>
			api.addTeamUser(data),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: queryKeys.team.users });
		},
	});
}

export function useUpdateTeamUser() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ email, data }: { email: string; data: { displayName?: string; role?: "admin" | "member"; storageQuotaBytes?: number; messagesPerDay?: number } }) =>
			api.updateTeamUser(email, data),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: queryKeys.team.users });
		},
	});
}

export function useRemoveTeamUser() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (email: string) => api.removeTeamUser(email),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: queryKeys.team.users });
		},
	});
}

export function useMailboxShares(mailboxId: string | undefined) {
	return useQuery<MailboxShares>({
		queryKey: mailboxId ? queryKeys.team.mailboxShares(mailboxId) : ["team", "shares", "_disabled"],
		queryFn: () => api.getMailboxShares(mailboxId!),
		enabled: !!mailboxId,
	});
}

export function useSetMailboxShares() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ mailboxId, userEmails }: { mailboxId: string; userEmails: string[] }) =>
			api.setMailboxShares(mailboxId, userEmails),
		onSuccess: (_d, { mailboxId }) => {
			qc.invalidateQueries({ queryKey: queryKeys.team.mailboxShares(mailboxId) });
			qc.invalidateQueries({ queryKey: queryKeys.mailboxes.all });
		},
	});
}

export type { TeamMe, TeamProfile, TeamUser, TeamUserWithUsage };
