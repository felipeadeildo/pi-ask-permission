import type { GrantScope } from "./grants.ts";

export interface AskDecision {
	decision: "allow" | "deny";
	/** A note on an approval, or the reason on a denial. */
	note?: string;
	/** Level to remember for the rest of the session. */
	remember?: string;
	/** Where to remember it. Only meaningful alongside `remember`. */
	scope?: GrantScope;
}

export interface DecisionOption {
	key: string;
	decision: "allow" | "deny";
	always: boolean;
	label: string;
	tone: "success" | "warning" | "error";
}

export const BASE_OPTIONS: DecisionOption[] = [
	{ key: "1", decision: "allow", always: false, label: "yes", tone: "success" },
	{ key: "2", decision: "allow", always: true, label: "always yes", tone: "warning" },
	{ key: "3", decision: "deny", always: false, label: "deny", tone: "error" },
];

/** Flat rows for UIs without a Tab key, where the note modifier is its own row. */
export const FALLBACK_OPTIONS: (DecisionOption & { note: boolean })[] = BASE_OPTIONS.flatMap(
	(option, index) => [
		{ ...option, key: String(index * 2 + 1), note: false },
		{
			...option,
			key: String(index * 2 + 2),
			note: true,
			label: `${option.label}, ${option.decision === "allow" ? "with a note" : "with a reason"}`,
		},
	],
);
