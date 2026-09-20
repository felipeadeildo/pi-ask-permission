import type { GrantScope } from "#core/grants.ts";

/** What the user chose, and anything they attached to it. */
export interface PermissionDecision {
	decision: "allow" | "deny";
	/** A note on an approval, or the reason on a denial. */
	note?: string;
	/** Grant level to remember. */
	remember?: string;
	/** Scope for `remember`. */
	scope?: GrantScope;
}
