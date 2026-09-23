import type { GrantScope } from "#core/grants.ts";

export interface DialogAnswer {
	decision: "allow" | "deny";
	note?: string;
	remember?: string;
	scope?: GrantScope;
}
