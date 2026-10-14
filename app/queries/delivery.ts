// Copyright (c) 2026 Postbox contributors.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/APACHE-2.0

import { useQuery } from "@tanstack/react-query";
import api from "~/services/api";
import type { DeliveryStats, DeliveryOriginFilter } from "~/types";
import { queryKeys } from "./keys";

export function useDeliveryStats(days: 7 | 30, domain?: string, origin: DeliveryOriginFilter = "all") {
	return useQuery<DeliveryStats>({
		queryKey: queryKeys.delivery.stats(days, domain, origin),
		queryFn: () => api.getDeliveryStats(days, domain?.trim() || undefined, origin),
		staleTime: 30_000,
	});
}
