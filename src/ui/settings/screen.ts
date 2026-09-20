import { type ExtensionContext, getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { Container, type SettingItem, SettingsList, Text } from "@earendil-works/pi-tui";

import { isFollowupDelivery, isHeadlessMode, type PermissionConfig } from "#core/config/schema.ts";
import { type GrantScope, GRANT_SCOPES } from "#core/grants.ts";
import { POLICY_TEMPLATE, policyWarning } from "#core/judge/policy.ts";
import { NAME } from "#identity";
import { buildJudgeSettings, type JudgeSettings, judgeValues } from "#ui/settings/judge.ts";

export interface SettingsState {
	config: PermissionConfig;
	grants: Record<GrantScope, Set<string>>;
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

const SETTINGS_VISIBLE = 16;

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

			return [
				followupItem(state.config),
				judgeToggleItem(state.config),
				...children,
				headlessItem(state.config),
				yoloItem(state.config),
			];
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
				return;
			}

			if (id.startsWith("judge.")) {
				judgeSettings?.onChange(id, value);
				refreshModelRow();
				return;
			}

			if (id === "followup" && isFollowupDelivery(value)) state.config.followup = value;
			else if (id === "headless" && isHeadlessMode(value)) state.config.headless = value;
			else if (id === "yolo") state.config.yolo = value === "on";
			state.save();
		};

		container.addChild(
			new Text(
				theme.fg("accent", theme.bold(NAME)) +
					theme.fg("dim", `  \u00b7  ${grantCount(totalGrants(state.grants))} held`),
				1,
				1,
			),
		);
		install("followup");

		return {
			render: (width: number) => container.render(width),
			invalidate: () => container.invalidate(),
			handleInput: (data: string) => settings?.handleInput?.(data),
		};
	});

	return request;
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

function yoloItem(config: PermissionConfig): SettingItem {
	return {
		id: "yolo",
		label: "Yolo mode",
		currentValue: config.yolo ? "on" : "off",
		values: ["off", "on"],
		description: "Approve every call without asking",
	};
}

function piModelIds(ctx: ExtensionContext): string[] {
	return ctx.modelRegistry
		.getAvailable()
		.map((model) => `${model.provider}/${model.id}`)
		.toSorted((left, right) => left.localeCompare(right));
}

export function totalGrants(grants: Record<GrantScope, Set<string>>): number {
	return GRANT_SCOPES.reduce((total, scope) => total + grants[scope].size, 0);
}

export function grantCount(count: number): string {
	return `${count} grant${count === 1 ? "" : "s"}`;
}
