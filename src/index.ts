/**
 * pi-ask-permission — a permission gate you can actually answer.
 *
 * Every tool call that is not on the allowlist stops and asks, with three
 * choices: yes / always yes / deny. Tab turns any of them into a followup, so
 * "yes, and..." and "deny, because..." cost one keystroke rather than three rows.
 * "Always yes" opens a depth picker built from the call itself, so the grant is
 * as wide as you meant and no wider.
 *
 * Config: <agentDir>/extensions/pi-ask-permission/config.json
 * Commands: /perm, /perm status, /perm reset
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { Container, type SettingItem, SettingsList, Text } from "@earendil-works/pi-tui";

import {
	type AskConfig,
	type FollowupWire,
	type HeadlessMode,
	headlessMode,
	isAllowed,
	loadConfig,
	saveConfig,
} from "./config.ts";
import { type AskDecision, AskDialog, askViaSelector } from "./dialog.ts";
import { type CallTarget, deriveTarget } from "./targets.ts";

export default function piAskPermission(pi: ExtensionAPI) {
	const loaded = loadConfig();
	const config = loaded.config;

	/** Session-scoped memory for "always yes", keyed `tool\0level`. */
	const approved = new Set<string>();
	/** Approval notes waiting for their tool result, keyed by tool call id. */
	const pendingNotes = new Map<string, string>();

	pi.on("session_start", (_event, ctx) => {
		for (const warning of loaded.warnings)
			ctx.ui.notify(`pi-ask-permission: ${warning}`, "warning");
		refreshStatus(ctx, approved.size);
	});

	pi.on("tool_call", async (event, ctx) => {
		if (config.yolo) return undefined;

		const toolName = event.toolName;
		if (isAllowed(config, toolName)) return undefined;

		const target = deriveTarget(toolName, event.input, ctx.cwd);
		if (target.levels.some((level) => approved.has(memoryKey(toolName, level)))) return undefined;

		if (!ctx.hasUI) return headlessRefusal(config, toolName);

		const decision = await ask(ctx, toolName, target);

		if (decision.decision === "deny") {
			return { block: true, reason: denyReason(decision.note) };
		}

		if (decision.remember) {
			approved.add(memoryKey(toolName, decision.remember));
			refreshStatus(ctx, approved.size);
			ctx.ui.notify(
				`pi-ask-permission: always yes for ${toolName} \u00b7 ${decision.remember}`,
				"info",
			);
		}

		if (decision.note) {
			if (config.followup === "message") sendNote(pi, decision.note, toolName);
			else pendingNotes.set(event.toolCallId, decision.note);
		}

		return undefined;
	});

	// With `followup: "result"` the note rides inside the tool result, so it
	// arrives with the output the model is already reading rather than as a turn
	// of its own.
	pi.on("tool_result", async (event) => {
		const note = pendingNotes.get(event.toolCallId);
		if (!note) return undefined;
		pendingNotes.delete(event.toolCallId);
		return { content: [...event.content, { type: "text", text: noteBlock(note) }] };
	});

	pi.registerCommand("perm", {
		description: "pi-ask-permission: settings, status, reset",
		handler: async (args, ctx) => {
			const verb = args.trim().toLowerCase();

			if (verb === "reset") {
				const count = approved.size;
				approved.clear();
				refreshStatus(ctx, approved.size);
				ctx.ui.notify(
					`pi-ask-permission: forgot ${count} session approval${count === 1 ? "" : "s"}`,
					"info",
				);
				return;
			}

			if (verb === "status" || ctx.mode !== "tui") {
				ctx.ui.notify(statusText(config, approved.size, loaded.path), "info");
				return;
			}

			await openSettings(ctx, {
				config,
				approved,
				save: () => {
					const error = saveConfig(config);
					if (error) ctx.ui.notify(`pi-ask-permission: could not save config: ${error}`, "error");
				},
			});
		},
	});
}

interface SettingsState {
	config: AskConfig;
	approved: Set<string>;
	save: () => void;
}

async function openSettings(ctx: ExtensionContext, state: SettingsState): Promise<void> {
	const headlessLabel =
		typeof state.config.headless === "string" ? state.config.headless : "per tool";

	const items: SettingItem[] = [
		{
			id: "followup",
			label: "Followup wire",
			currentValue: state.config.followup,
			values: ["result", "message"],
			description: "Where a note attached to an approval reaches the model",
		},
		{
			id: "headless",
			label: "No-UI behavior",
			currentValue: headlessLabel,
			values: ["deny", "allow"],
			description: "What happens when nobody can be asked (print, json, headless)",
		},
		{
			id: "yolo",
			label: "Yolo mode",
			currentValue: state.config.yolo ? "on" : "off",
			values: ["off", "on"],
			description: "Approve every call without asking",
		},
	];

	await ctx.ui.custom<void>((_tui, theme, _keybindings, done) => {
		const container = new Container();
		const count = state.approved.size;
		container.addChild(
			new Text(
				`${theme.fg("accent", theme.bold("pi-ask-permission"))}${theme.fg("dim", `  \u00b7  ${count} session approval${count === 1 ? "" : "s"}`)}`,
				1,
				1,
			),
		);

		const settings = new SettingsList(
			items,
			items.length + 2,
			getSettingsListTheme(),
			(id, newValue) => {
				if (id === "followup") state.config.followup = newValue as FollowupWire;
				else if (id === "headless") state.config.headless = newValue as HeadlessMode;
				else if (id === "yolo") state.config.yolo = newValue === "on";
				state.save();
			},
			() => done(undefined),
		);

		container.addChild(settings);

		return {
			render: (width: number) => container.render(width),
			invalidate: () => container.invalidate(),
			handleInput: (data: string) => {
				settings.handleInput?.(data);
			},
		};
	});
}

async function ask(
	ctx: ExtensionContext,
	toolName: string,
	target: CallTarget,
): Promise<AskDecision> {
	if (ctx.mode === "tui") {
		try {
			const decision = await ctx.ui.custom<AskDecision>(
				(tui, theme, _keybindings, done) =>
					new AskDialog({
						theme,
						toolName,
						target,
						requestRender: () => tui.requestRender(),
						complete: done,
					}),
			);
			if (decision) return decision;
		} catch {
			// Fall through to the plain selector rather than failing the call open.
		}
	}

	return askViaSelector(ctx, toolName, target);
}

function memoryKey(toolName: string, level: string): string {
	return `${toolName}\u0000${level}`;
}

function headlessRefusal(
	config: AskConfig,
	toolName: string,
): { block: true; reason: string } | undefined {
	if (headlessMode(config, toolName) === "allow") return undefined;
	return { block: true, reason: `pi-ask-permission: no UI available to approve "${toolName}"` };
}

function sendNote(pi: ExtensionAPI, note: string, toolName: string): void {
	void pi.sendMessage(
		{
			customType: "pi-ask-permission",
			content: noteBlock(note),
			display: true,
			details: { toolName },
		},
		{ deliverAs: "steer" },
	);
}

function noteBlock(note: string): string {
	return `[pi-ask-permission] the user approved this call and added:\n${note}`;
}

function denyReason(note?: string): string {
	return note
		? `pi-ask-permission: denied by the user.\n${note}`
		: "pi-ask-permission: denied by the user.";
}

function refreshStatus(ctx: ExtensionContext, count: number): void {
	ctx.ui.setStatus("pi-ask-permission", count > 0 ? `pi-ask: ${count} approved` : undefined);
}

function statusText(config: AskConfig, approvals: number, path: string): string {
	const headless =
		typeof config.headless === "string" ? config.headless : JSON.stringify(config.headless);
	return [
		`pi-ask-permission \u00b7 ${path}`,
		`allow: ${config.allow.join(", ") || "(none)"}`,
		`followup: ${config.followup} \u00b7 headless: ${headless} \u00b7 yolo: ${config.yolo ? "on" : "off"}`,
		`session approvals: ${approvals}`,
	].join("\n");
}
