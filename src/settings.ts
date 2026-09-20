/**
 * The `/perm` settings screen and the `/perm status` text. Kept apart from the
 * event wiring so `index.ts` stays about decisions and this file stays about UI.
 */
import {
	CONFIG_DIR_NAME,
	type ExtensionContext,
	getSettingsListTheme,
} from "@earendil-works/pi-coding-agent";
import { Container, type SettingItem, SettingsList, Text } from "@earendil-works/pi-tui";

import { isFollowupDelivery, isHeadlessMode, type PermissionConfig } from "./core/config/schema.ts";
import { grantsPath, projectGrantsPath } from "./core/config/store.ts";
import { type GrantScope, GRANT_SCOPES } from "./grants.ts";
import { NAME } from "./identity.ts";
import { POLICY_TEMPLATE, policyWarning } from "./judge/policy.ts";
import { buildJudgeSettings, type JudgeSettings, judgeValues } from "./judge/settings.ts";

export interface SettingsState {
	config: PermissionConfig;
	grants: Record<GrantScope, Set<string>>;
	save: () => void;
	/** Clears cached judge verdicts after any judge setting changes. */
	onJudgeChange: () => void;
}

type SettingsRequest = { kind: "policy" } | { kind: "model" } | undefined;

/**
 * Opens settings, then handles any request that needs a bigger UI than a list
 * row (the policy editor, a model name) before reopening the list.
 */
export async function openSettings(ctx: ExtensionContext, state: SettingsState): Promise<void> {
	// Each pass is one visit to the menu: it may open, ask for one bigger input, then reopen.
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

/** How many rows the settings list shows before it starts scrolling. */
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

		/** The judge's rows are children of the toggle, so they read as one group. */
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

		/**
		 * Only the model row depends on another row: switching backend picks a new
		 * default. Refreshing every row would fight the value the user just chose.
		 */
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

/** The toggle lives here, on the parent row, so there is no duplicate on the child page. */
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

export function statusText(
	config: PermissionConfig,
	grants: Record<GrantScope, Set<string>>,
	configFile: string,
	cwd: string,
): string {
	const headless =
		typeof config.headless === "string" ? config.headless : JSON.stringify(config.headless);

	return [
		`${NAME} \u00b7 ${configFile}`,
		`allow: ${config.allow.join(", ") || "(none)"}`,
		`followup: ${config.followup} \u00b7 headless: ${headless} \u00b7 yolo: ${config.yolo ? "on" : "off"}`,
		`typing: pause ${config.typing.pause}ms \u00b7 maxWait ${config.typing.maxWait ?? "none"}`,
		`readOnlyBash: ${config.readOnlyBash ? "on" : "off"}`,
		judgeLine(config),
		`grants: ${GRANT_SCOPES.map((scope) => `${grants[scope].size} ${scope}`).join(" \u00b7 ")}`,
		`project file: ${projectGrantsPath(cwd, CONFIG_DIR_NAME)}`,
		`global file: ${grantsPath()}`,
	].join("\n");
}

function judgeLine(config: PermissionConfig): string {
	const judge = config.judge;
	if (!judge.enabled) return `judge: off \u00b7 ${judge.backend}/${judge.model}`;

	const policy = judge.policy.trim() === "" ? "no policy" : "policy set";
	const tags = [
		judge.dryRun ? "dry run" : undefined,
		judge.autoDeny ? undefined : "approve only",
		judge.headless ? "headless" : undefined,
		policy,
	].filter((tag): tag is string => tag !== undefined);

	return `judge: on \u00b7 ${judge.backend}/${judge.model} \u00b7 tools ${judge.tools.join(",") || "(none)"} \u00b7 ${tags.join(" \u00b7 ")}`;
}

export function totalGrants(grants: Record<GrantScope, Set<string>>): number {
	return GRANT_SCOPES.reduce((total, scope) => total + grants[scope].size, 0);
}

export function grantCount(count: number): string {
	return `${count} grant${count === 1 ? "" : "s"}`;
}
