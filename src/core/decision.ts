import type { GrantScope } from "#core/grants.ts";

export interface PermissionDecision {
	decision: "allow" | "deny";

	note?: string;

	remember?: string;

	scope?: GrantScope;
}
