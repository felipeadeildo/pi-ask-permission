import { type ExtensionContext, getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { Container, type SettingItem, SettingsList, Text } from "@earendil-works/pi-tui";

import type { AlwaysYes } from "#core/always-yes.ts";
import {
	isNoteDelivery,
	isNoUIMode,
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
				const mode = modeFromLabel(value);
				if (mode) state.setMode(mode);
				install("mode");
				return;
			}

			if (id === "workspace.outside" && isOutsideScope(value)) {
				state.config.workspace.outside = value;
				state.save();
				state.setMode(state.mode());
				return;
			}

			if (id === "notes" && isNoteDelivery(value)) state.config.notes = value;
			else if (id === "noUI" && isNoUIMode(value)) state.config.noUI = value;
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
	const items = [modeItem(mode), outsideItem(config), notesItem(config)];
	if (mode !== "auto") items.push(readOnlyBashItem(config));

	return [...items, judgeToggleItem(config), ...judgeChildren, noUIItem(config)];
}

function notesItem(config: PermissionConfig): SettingItem {
	return {
		id: "notes",
		label: "Notes",
		currentValue: config.notes,
		values: ["result", "message"],
		description: "result adds your note to the tool result. message sends it on its own.",
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
	ask: "A call outside workspace.roots asks you. The judge never sees it.",
	deny: "A call outside workspace.roots is blocked.",
	allow: "No boundary. auto runs everything, anywhere.",
};

export function readOnlyBashItem(config: PermissionConfig): SettingItem {
	return {
		id: "readOnlyBash",
		label: "Read-only bash",
		currentValue: config.readOnlyBash ? "on" : "off",
		values: ["off", "on"],
		description: "Commands that only read run without asking.",
	};
}

export function judgeToggleItem(config: PermissionConfig): SettingItem {
	return {
		id: "judge.enabled",
		label: "Judge",
		currentValue: config.judge.enabled ? "on" : "off",
		values: ["off", "on"],
		description: "A model answers first. Only the calls it is unsure about reach you.",
	};
}

function noUIItem(config: PermissionConfig): SettingItem {
	return {
		id: "noUI",
		label: "With no UI",
		currentValue: typeof config.noUI === "string" ? config.noUI : "per tool",
		values: ["deny", "allow"],
		description: "When nobody can answer, as in print mode or a subagent.",
	};
}

export function modeItem(mode: PermissionMode): SettingItem {
	return {
		id: "mode",
		label: "Mode (this session)",
		currentValue: MODE_LABEL[mode],
		values: PERMISSION_MODES.map((entry) => MODE_LABEL[entry]),
		description:
			"manual asks. accept edits runs file edits. auto runs everything in the workspace.",
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
