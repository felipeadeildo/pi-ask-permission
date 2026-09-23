import type { Scope } from "#core/always-yes.ts";

export interface DialogAnswer {
	decision: "allow" | "deny";
	note?: string;
	remember?: string;
	scope?: Scope;
}
