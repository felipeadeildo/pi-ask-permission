import type { Theme } from "@earendil-works/pi-coding-agent";
import type { SettingItem } from "@earendil-works/pi-tui";

import type { JudgeBackendId, JudgeConfig, JudgeFallback } from "#core/judge/config.ts";
import {
	detectPolicyPreset,
	getPolicyPreset,
	POLICY_PRESETS,
	policyWarning,
} from "#core/judge/policy.ts";
import { PickerList } from "#ui/picker.ts";

const PROVIDER_LABEL: Record<JudgeBackendId, string> = {
	jev: "Jev",
	pi: "A pi model",
};

const FALLBACK_LABEL: Record<JudgeFallback, string> = {
	ask: "Ask me",
	allow: "Allow",
	deny: "Deny",
};

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

	piModels: string[];
	save: () => void;
	editPolicy: () => void;
	editModel: () => void;
}

export interface JudgeSettings {
	items: SettingItem[];
	onChange: (id: string, value: string) => void;
}

type SubmenuDone = (selectedValue?: string, options?: { navigateTo?: string }) => void;

export function buildJudgeSettings(hooks: JudgeSettingsHooks): JudgeSettings {
	const values = judgeValues(hooks.config);
	const item = (id: JudgeSettingId, label: string, description: string): SettingItem => ({
		id,
		label,
		currentValue: values[id],
		description,
	});
	const choice = (id: JudgeSettingId, label: string, choices: string[], description: string) => ({
		...item(id, label, description),
		values: choices,
	});
	const onOff = (id: JudgeSettingId, label: string, description: string) =>
		choice(id, label, ["off", "on"], description);
	const fallbacks = Object.values(FALLBACK_LABEL);

	return {
		items: [
			choice(
				"judge.provider",
				"Provider",
				Object.values(PROVIDER_LABEL),
				"Jev answers fast, with a confidence. A pi model uses one you already set up.",
			),
			{
				...item(
					"judge.model",
					"Model",
					hooks.config.provider === "jev"
						? "A Jev alias, or a pinned version."
						: "The judge asks it for strict JSON.",
				),
				submenu: (_current, done) => modelPicker(hooks, done),
			},
			onOff("judge.canDeny", "Can deny", "A confident no blocks the call. Off, it comes to you."),
			choice("judge.whenUnsure", "When unsure", fallbacks, "When the judge is not confident."),
			choice(
				"judge.whenItFails",
				"When it fails",
				fallbacks,
				"On a timeout, an error, or a missing key.",
			),
			choice(
				"judge.tools",
				"Tools",
				TOOL_PRESETS.map((preset) => preset.label),
				"The judge decides these. The rest come to you.",
			),
			{
				...item("judge.policy", "Policy", policyDescription(hooks.config.policy)),
				submenu: (_current, done) => policyPicker(hooks, done),
			},
			onOff("judge.dryRun", "Dry run", "Show the verdict, and still ask you."),
			onOff("judge.noUI", "Judge with no UI", "Also judge print, JSON, and subagent runs."),
			onOff(
				"judge.rememberApprovals",
				"Remember approvals",
				"A judge approval becomes always yes for this session.",
			),
		],
		onChange: (id, value) => {
			apply(hooks, id, value);
			hooks.save();
		},
	};
}

export type JudgeSettingId =
	| "judge.provider"
	| "judge.model"
	| "judge.canDeny"
	| "judge.whenUnsure"
	| "judge.whenItFails"
	| "judge.tools"
	| "judge.policy"
	| "judge.dryRun"
	| "judge.noUI"
	| "judge.rememberApprovals";

export function judgeValues(config: JudgeConfig): Record<JudgeSettingId, string> {
	return {
		"judge.provider": PROVIDER_LABEL[config.provider],
		"judge.model": config.model || "(none)",
		"judge.canDeny": toggle(config.canDeny),
		"judge.whenUnsure": FALLBACK_LABEL[config.whenUnsure],
		"judge.whenItFails": FALLBACK_LABEL[config.whenItFails],
		"judge.tools": toolsLabel(config.tools),
		"judge.policy": policyLabel(config.policy),
		"judge.dryRun": toggle(config.dryRun),
		"judge.noUI": toggle(config.noUI),
		"judge.rememberApprovals": toggle(config.rememberApprovals),
	};
}

function apply(hooks: JudgeSettingsHooks, id: string, value: string): void {
	const judge = hooks.config;

	switch (id) {
		case "judge.provider":
			judge.provider = value === PROVIDER_LABEL.pi ? "pi" : "jev";
			judge.model = defaultModelFor(judge.provider, hooks.piModels, judge.model);
			return;
		case "judge.model":
			judge.model = value;
			return;
		case "judge.canDeny":
			judge.canDeny = value === "on";
			return;
		case "judge.whenUnsure":
			judge.whenUnsure = fallbackFromLabel(value);
			return;
		case "judge.whenItFails":
			judge.whenItFails = fallbackFromLabel(value);
			return;
		case "judge.tools":
			judge.tools = toolsFromLabel(value) ?? judge.tools;
			return;
		case "judge.policy": {
			const preset = POLICY_PRESETS.find((entry) => entry.label === value);
			if (preset) judge.policy = preset.policy;
			return;
		}
		case "judge.dryRun":
			judge.dryRun = value === "on";
			return;
		case "judge.noUI":
			judge.noUI = value === "on";
			return;
		case "judge.rememberApprovals":
			judge.rememberApprovals = value === "on";
			return;
	}
}

function defaultModelFor(provider: JudgeBackendId, piModels: string[], current: string): string {
	if (provider === "jev") return JEV_MODELS.includes(current) ? current : "jev-latest";
	if (piModels.includes(current)) return current;
	return piModels[0] ?? "";
}

function modelPicker(hooks: JudgeSettingsHooks, done: SubmenuDone): PickerList {
	const items =
		hooks.config.provider === "jev"
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
		hooks.config.provider === "jev" ? "Jev model" : "pi model",
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

	const preset = getPolicyPreset(detectPolicyPreset(policy));
	return preset?.description ?? "The judge reads this as the rulebook for what may run.";
}
