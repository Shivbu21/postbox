import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["workers/lib/delivery.test.ts", "workers/lib/agent-identity.test.ts"],
	},
});
