export interface Choice {
	key: string;
	decision: "allow" | "deny";
	always: boolean;
	label: string;
	tone: "success" | "warning" | "error";
}

export const CHOICES: Choice[] = [
	{ key: "1", decision: "allow", always: false, label: "yes", tone: "success" },
	{ key: "2", decision: "allow", always: true, label: "always yes", tone: "warning" },
	{ key: "3", decision: "deny", always: false, label: "deny", tone: "error" },
];

export const FALLBACK_CHOICES: (Choice & { note: boolean })[] = CHOICES.flatMap((option, index) => [
	{ ...option, key: String(index * 2 + 1), note: false },
	{
		...option,
		key: String(index * 2 + 2),
		note: true,
		label: `${option.label}, ${option.decision === "allow" ? "with a note" : "with a reason"}`,
	},
]);
