import { type ExtensionContext, getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { Container, type SettingItem, SettingsList, Text } from "@earendil-works/pi-tui";

import type { AlwaysYes } from "#core/always-yes.ts";
import {
	isFollowupDelivery,
	isHeadlessMode,
	isOutsideScope,
	type OutsideScope,
	type PermissionConfig,
} from "#core/config/schema.ts";
import { POLICY_TEMPLATE, policyWarning } from "#core/judge/policy.ts";
import { MODE_LABEL, modeFromLabel, PERMISSION_MODES, type PermissionMode } from "#core/mode.ts";
import { NAME } from "#identity";
import { buildJudgeSettings, type JudgeSettings, judgeValues } from "#ui/settings/judge.ts";
import { notifyJudgePolicyWarning } from "#ui/settings/status.ts";

export interface SettingsState {
	config: PermissionConfig;
	alwaysYes: AlwaysYes;
	/** Effective mode for this session, read live so the dialog stays truthful. */
	mode: () => PermissionMode;
	setMode: (mode: PermissionMode) => void;
	save: () => void;

	onJudgeChange: () => void;
}

type SettingsRequest = { kind: "policy" } | { kind: "model" } | undefined;

export async function openSettings(ctx: ExtensionContext, state: SettingsState): Promise<void> {
	for (;;) {
		// oxlint-disable-next-line no-await-in-loop -- the menu loop is sequential by design.
		const request = await showSettings(ctx, state);
		if (!request) return;

		if (request.kind === "policy") {
			// oxlint-disable-next-line no-await-in-loop -- one editor at a time.
			await editPolicy(ctx, state);
			continue;
		}

		// oxlint-disable-next-line no-await-in-loop -- one prompt at a time.
		await editModel(ctx, state);
	}
}

async function editPolicy(ctx: ExtensionContext, state: SettingsState): Promise<void> {
	const judge = state.config.judge;
	const text = await ctx.ui.editor("Judge policy", judge.policy || POLICY_TEMPLATE);
	if (text === undefined) return;

	judge.policy = text;
	state.save();
	state.onJudgeChange();

	const warning = policyWarning(text);
	if (warning) ctx.ui.notify(`${NAME}: ${warning}`, "warning");
}

async function editModel(ctx: ExtensionContext, state: SettingsState): Promise<void> {
	const text = await ctx.ui.input("Jev model", "jev-latest");
	const model = text?.trim();
	if (!model) return;

	state.config.judge.model = model;
	state.save();
	state.onJudgeChange();
}

const SETTINGS_VISIBLE = 18;

async function showSettings(ctx: ExtensionContext, state: SettingsState): Promise<SettingsRequest> {
	let request: SettingsRequest;

	await ctx.ui.custom<void>((_tui, theme, _keybindings, done) => {
		const close = () => done(undefined);
		const container = new Container();
		let settings: SettingsList | undefined;
		let judgeSettings: JudgeSettings | undefined;

		const hooks = {
			config: state.config.judge,
			theme,
			piModels: piModelIds(ctx),
			save: () => {
				state.save();
				state.onJudgeChange();
			},
			editPolicy: () => {
				request = { kind: "policy" };
				close();
			},
			editModel: () => {
				request = { kind: "model" };
				close();
			},
		};

		const buildItems = (): SettingItem[] => {
			judgeSettings = buildJudgeSettings(hooks);
			const children = state.config.judge.enabled
				? judgeSettings.items.map((item) => ({ ...item, label: `  ${item.label}` }))
				: [];

			return topLevelItems(state.config, state.mode(), children);
		};

		const install = (focusId: string): void => {
			if (settings) container.removeChild(settings);
			settings = new SettingsList(
				buildItems(),
				SETTINGS_VISIBLE,
				getSettingsListTheme(),
				onChange,
				close,
			);
			container.addChild(settings);
			settings.selectItem(focusId);
		};

		const refreshModelRow = (): void => {
			settings?.updateValue("judge.model", judgeValues(state.config.judge)["judge.model"]);
		};

		const onChange = (id: string, value: string): void => {
			if (id === "judge.enabled") {
				state.config.judge.enabled = value === "on";
				state.save();
				state.onJudgeChange();
				install("judge.enabled");
				notifyJudgePolicyWarning(state.config, ctx);
				return;
			}

			if (id.startsWith("judge.")) {
				judgeSettings?.onChange(id, value);
				refreshModelRow();
				return;
			}

			if (id === "mode") {
				// Session-only: the mode never reaches config.json, so it cannot leak into other sessions.
				const mode = modeFromLabel(value);
				if (mode) state.setMode(mode);
				install("mode");
				return;
			}

			if (id === "workspace.outside" && isOutsideScope(value)) {
				state.config.workspace.outside = value;
				state.save();
				// The status bar spells out `auto \u00b7 anywhere`, so it moves with this row.
				state.setMode(state.mode());
				return;
			}

			if (id === "followup" && isFollowupDelivery(value)) state.config.followup = value;
			else if (id === "headless" && isHeadlessMode(value)) state.config.headless = value;
			else if (id === "readOnlyBash") state.config.readOnlyBash = value === "on";
			state.save();
		};

		container.addChild(
			new Text(
				theme.fg("accent", theme.bold(NAME)) +
					theme.fg("dim", `  \u00b7  ${alwaysYesCount(state.alwaysYes.total())}`),
				1,
				1,
			),
		);
		install("mode");

		return {
			render: (width: number) => container.render(width),
			invalidate: () => container.invalidate(),
			handleInput: (data: string) => settings?.handleInput?.(data),
		};
	});

	return request;
}

export function topLevelItems(
	config: PermissionConfig,
	mode: PermissionMode,
	judgeChildren: SettingItem[],
): SettingItem[] {
	const items = [modeItem(mode), outsideItem(config), followupItem(config)];
	// `auto` approves everything inside the workspace before the read-only check runs.
	if (mode !== "auto") items.push(readOnlyBashItem(config));

	return [...items, judgeToggleItem(config), ...judgeChildren, headlessItem(config)];
}

function followupItem(config: PermissionConfig): SettingItem {
	return {
		id: "followup",
		label: "Followup wire",
		currentValue: config.followup,
		values: ["result", "message"],
		description: "Where a note attached to an approval reaches the model",
	};
}

export function outsideItem(config: PermissionConfig): SettingItem {
	const outside = config.workspace.outside;
	return {
		id: "workspace.outside",
		label: "Outside the workspace",
		currentValue: outside,
		values: ["ask", "deny", "allow"],
		description: OUTSIDE_DESCRIPTION[outside],
	};
}

const OUTSIDE_DESCRIPTION: Record<OutsideScope, string> = {
	ask: "A call that leaves workspace.roots comes straight to you, and skips the judge",
	deny: "A call that leaves workspace.roots is blocked, with no dialog",
	allow: "The boundary is off. With mode auto, every call runs anywhere, which is the old yolo",
};

export function readOnlyBashItem(config: PermissionConfig): SettingItem {
	return {
		id: "readOnlyBash",
		label: "Read-only bash",
		currentValue: config.readOnlyBash ? "on" : "off",
		values: ["off", "on"],
		description: "A read-only command that stays in the workspace runs without a prompt",
	};
}

export function judgeToggleItem(config: PermissionConfig): SettingItem {
	return {
		id: "judge.enabled",
		label: "AI approvals (judge)",
		currentValue: config.judge.enabled ? "on" : "off",
		values: ["off", "on"],
		description: config.judge.enabled
			? "A judge model approves or denies confident calls; uncertain ones still come to you."
			: "Delegate the yes/no to a model. Turn it on to show its settings below.",
	};
}

function headlessItem(config: PermissionConfig): SettingItem {
	return {
		id: "headless",
		label: "No-UI behavior",
		currentValue: typeof config.headless === "string" ? config.headless : "per tool",
		values: ["deny", "allow"],
		description: "What happens when nobody can be asked (print, json, headless)",
	};
}

export function modeItem(mode: PermissionMode): SettingItem {
	return {
		id: "mode",
		label: "Mode (this session)",
		currentValue: MODE_LABEL[mode],
		values: PERMISSION_MODES.map((entry) => MODE_LABEL[entry]),
		description:
			"manual asks, accept edits runs file writes, auto runs everything in the workspace; Outside decides the rest",
	};
}

function piModelIds(ctx: ExtensionContext): string[] {
	return ctx.modelRegistry
		.getAvailable()
		.map((model) => `${model.provider}/${model.id}`)
		.toSorted((left, right) => left.localeCompare(right));
}

export function alwaysYesCount(count: number): string {
	return `${count} always yes`;
}
