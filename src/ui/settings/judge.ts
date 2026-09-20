/**
 * The judge settings screen, built as `SettingItem`s so it plugs into the same
 * `SettingsList` as the rest of `/perm`. Labels and descriptions carry the
 * meaning here: every row should be legible without reading the config file.
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { SettingItem } from "@earendil-works/pi-tui";

import type { JudgeBackendId, JudgeConfig, JudgeFallback } from "#core/config/schema.ts";
import {
	detectPolicyPreset,
	getPolicyPreset,
	POLICY_PRESETS,
	policyWarning,
} from "#core/judge/policy.ts";
import { PickerList } from "#ui/picker.ts";

const BACKEND_LABEL: Record<JudgeBackendId, string> = {
	jev: "Jev (TypeSafe)",
	pi: "A pi model",
};

const FALLBACK_LABEL: Record<JudgeFallback, string> = {
	ask: "Ask me",
	allow: "Allow",
	deny: "Deny",
};

/** Aliases and current pinned versions offered by the Jev picker. */
export const JEV_MODELS = ["jev-latest", "jev-preview", "jev-1.13.0"];

interface ToolPreset {
	label: string;
	tools: string[];
}

const TOOL_PRESETS: ToolPreset[] = [
	{ label: "Bash only", tools: ["bash"] },
	{ label: "Bash and file writes", tools: ["bash", "write", "edit"] },
	{ label: "Every tool", tools: ["*"] },
];

export interface JudgeSettingsHooks {
	config: JudgeConfig;
	theme: Theme;
	/** `provider/modelId` for every model pi can use, in display order. */
	piModels: string[];
	save: () => void;
	/** Close settings and open the policy editor. */
	editPolicy: () => void;
	/** Close settings and prompt for a Jev model name. */
	editModel: () => void;
}

export interface JudgeSettings {
	items: SettingItem[];
	onChange: (id: string, value: string) => void;
}

type SubmenuDone = (selectedValue?: string, options?: { navigateTo?: string }) => void;

export function buildJudgeSettings(hooks: JudgeSettingsHooks): JudgeSettings {
	const values = judgeValues(hooks.config);

	return {
		items: [
			{
				id: "judge.backend",
				label: "Judge",
				currentValue: values["judge.backend"],
				values: [BACKEND_LABEL.jev, BACKEND_LABEL.pi],
				description:
					"Jev is a fast decision model that returns confidence. A pi model reuses any model you already configured.",
			},
			{
				id: "judge.model",
				label: "Model",
				currentValue: values["judge.model"],
				description:
					hooks.config.backend === "jev"
						? "A Jev alias, or a pinned version if you tuned the thresholds."
						: "Any configured model. The judge asks it for strict JSON.",
				submenu: (_current, done) => modelPicker(hooks, done),
			},
			{
				id: "judge.authority",
				label: "When confident",
				currentValue: values["judge.authority"],
				values: ["Approve or deny", "Approve only"],
				description:
					"Whether a confident judge may also block a call, or only wave it through. Denials never auto-run without this.",
			},
			{
				id: "judge.onUncertain",
				label: "When unsure",
				currentValue: values["judge.onUncertain"],
				values: ["Ask me", "Allow", "Deny"],
				description: "What happens when the judge is not confident enough to decide.",
			},
			{
				id: "judge.onError",
				label: "When it can't answer",
				currentValue: values["judge.onError"],
				values: ["Ask me", "Allow", "Deny"],
				description:
					"What happens if the judge times out, errors, or has no API key. Asking you is the safe default.",
			},
			{
				id: "judge.tools",
				label: "Tools it may judge",
				currentValue: values["judge.tools"],
				values: TOOL_PRESETS.map((preset) => preset.label),
				description:
					"Which tools the judge may decide. Everything else always comes to you. Hand-edited patterns in config.json show as Custom.",
			},
			{
				id: "judge.policy",
				label: "Policy",
				currentValue: values["judge.policy"],
				description: policyDescription(hooks.config.policy),
				submenu: (_current, done) => policyPicker(hooks, done),
			},
			{
				id: "judge.dryRun",
				label: "Dry run",
				currentValue: values["judge.dryRun"],
				values: ["off", "on"],
				description:
					"Ask the judge and show its verdict, but still ask you. Use this to build trust before enabling.",
			},
			{
				id: "judge.headless",
				label: "Judge with no UI",
				currentValue: values["judge.headless"],
				values: ["off", "on"],
				description:
					"Also let the judge decide in print, JSON, and subagent runs, where nobody can be asked.",
			},
			{
				id: "judge.grant",
				label: "Remember approvals",
				currentValue: values["judge.grant"],
				values: ["off", "on"],
				description: "Treat a judge approval as a grant for the rest of the session.",
			},
		],
		onChange: (id, value) => {
			apply(hooks, id, value);
			hooks.save();
		},
	};
}

/** Every row the judge screen owns, so a change can refresh the whole list. */
export type JudgeSettingId =
	| "judge.backend"
	| "judge.model"
	| "judge.authority"
	| "judge.onUncertain"
	| "judge.onError"
	| "judge.tools"
	| "judge.policy"
	| "judge.dryRun"
	| "judge.headless"
	| "judge.grant";

export const JUDGE_SETTING_IDS: JudgeSettingId[] = [
	"judge.backend",
	"judge.model",
	"judge.authority",
	"judge.onUncertain",
	"judge.onError",
	"judge.tools",
	"judge.policy",
	"judge.dryRun",
	"judge.headless",
	"judge.grant",
];

/** The display value for each judge row, so the screen refreshes after any change. */
export function judgeValues(config: JudgeConfig): Record<JudgeSettingId, string> {
	return {
		"judge.backend": BACKEND_LABEL[config.backend],
		"judge.model": config.model || "(none)",
		"judge.authority": config.autoDeny ? "Approve or deny" : "Approve only",
		"judge.onUncertain": FALLBACK_LABEL[config.onUncertain],
		"judge.onError": FALLBACK_LABEL[config.onError],
		"judge.tools": toolsLabel(config.tools),
		"judge.policy": policyLabel(config.policy),
		"judge.dryRun": toggle(config.dryRun),
		"judge.headless": toggle(config.headless),
		"judge.grant": toggle(config.grant),
	};
}

function apply(hooks: JudgeSettingsHooks, id: string, value: string): void {
	const judge = hooks.config;

	switch (id) {
		case "judge.backend":
			judge.backend = value === BACKEND_LABEL.pi ? "pi" : "jev";
			judge.model = defaultModelFor(judge.backend, hooks.piModels, judge.model);
			return;
		case "judge.model":
			judge.model = value;
			return;
		case "judge.authority":
			judge.autoDeny = value === "Approve or deny";
			return;
		case "judge.onUncertain":
			judge.onUncertain = fallbackFromLabel(value);
			return;
		case "judge.onError":
			judge.onError = fallbackFromLabel(value);
			return;
		case "judge.tools":
			judge.tools = toolsFromLabel(value) ?? judge.tools;
			return;
		case "judge.policy": {
			// The picker reports a preset label so the row stays readable.
			const preset = POLICY_PRESETS.find((entry) => entry.label === value);
			if (preset) judge.policy = preset.policy;
			return;
		}
		case "judge.dryRun":
			judge.dryRun = value === "on";
			return;
		case "judge.headless":
			judge.headless = value === "on";
			return;
		case "judge.grant":
			judge.grant = value === "on";
			return;
	}
}

/** Keeps a chosen model when switching back, so the picker does not reset it. */
function defaultModelFor(backend: JudgeBackendId, piModels: string[], current: string): string {
	if (backend === "jev") return JEV_MODELS.includes(current) ? current : "jev-latest";
	if (piModels.includes(current)) return current;
	return piModels[0] ?? "";
}

function modelPicker(hooks: JudgeSettingsHooks, done: SubmenuDone): PickerList {
	const items =
		hooks.config.backend === "jev"
			? [
					...JEV_MODELS.map((model) => ({
						id: model,
						label: model,
						description:
							model === "jev-latest" ? "The current stable release (recommended)" : undefined,
					})),
					{ id: "__other", label: "Other\u2026", description: "Type a model id or pinned version" },
				]
			: hooks.piModels.length > 0
				? hooks.piModels.map((model) => ({ id: model, label: model }))
				: [
						{
							id: "__none",
							label: "No models available",
							description: "Configure a model in pi first",
						},
					];

	return new PickerList(
		hooks.config.backend === "jev" ? "Jev model" : "pi model",
		items,
		hooks.theme,
		(id) => {
			if (id === "__other") {
				hooks.editModel();
				return;
			}
			if (id !== "__none") done(id);
		},
		() => done(),
		undefined,
		hooks.config.model,
	);
}

function policyPicker(hooks: JudgeSettingsHooks, done: SubmenuDone): PickerList {
	const items = [
		...POLICY_PRESETS.filter((preset) => preset.id !== "custom").map((preset) => ({
			id: preset.id,
			label: preset.label,
			description: preset.description,
		})),
		{
			id: "__edit",
			label: "Edit policy\u2026",
			description: "Write your own rules in a full editor",
		},
	];

	return new PickerList(
		"Policy",
		items,
		hooks.theme,
		(id) => {
			if (id === "__edit") {
				hooks.editPolicy();
				return;
			}
			const preset = getPolicyPreset(id);
			if (preset) done(preset.label);
		},
		() => done(),
		undefined,
		detectPolicyPreset(hooks.config.policy),
	);
}

function toggle(value: boolean): string {
	return value ? "on" : "off";
}

function fallbackFromLabel(label: string): JudgeFallback {
	if (label === "Allow") return "allow";
	if (label === "Deny") return "deny";
	return "ask";
}

function toolsLabel(tools: string[]): string {
	const match = TOOL_PRESETS.find((preset) => sameList(preset.tools, tools));
	return match?.label ?? "Custom";
}

function toolsFromLabel(label: string): string[] | undefined {
	return TOOL_PRESETS.find((preset) => preset.label === label)?.tools;
}

function sameList(left: string[], right: string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function policyLabel(policy: string): string {
	if (policy.trim() === "") return "(none yet)";
	return getPolicyPreset(detectPolicyPreset(policy))?.label ?? "Custom";
}

function policyDescription(policy: string): string {
	const warning = policyWarning(policy);
	if (warning) return warning;
	return "Your rules for what may run and what must always ask. The judge reads this as authoritative.";
}
