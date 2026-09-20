/**
 * pi-ask-permission: every tool call not on the allowlist stops and asks yes /
 * always yes / deny, each with an optional note.
 *
 * Config: <agentDir>/extensions/pi-ask-permission/config.json
 * Commands: /perm, /perm status, /perm reset [session|project|global|all]
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	CONFIG_DIR_NAME,
	getSettingsListTheme,
	isToolCallEventType,
} from "@earendil-works/pi-coding-agent";
import { Container, type SettingItem, SettingsList, Text } from "@earendil-works/pi-tui";

import {
	type AskConfig,
	grantsPath,
	headlessMode,
	isAllowed,
	isFollowupWire,
	isHeadlessMode,
	loadConfig,
	projectGrantsPath,
	saveConfig,
} from "./config.ts";
import { AskDialog } from "./dialog.ts";
import {
	type GrantScope,
	GRANT_SCOPES,
	SCOPE_LABEL,
	deleteGrants,
	grantKey,
	grantsFileExists,
	loadGrants,
	saveGrants,
} from "./grants.ts";
import { type AskDecision } from "./options.ts";
import { editFailure } from "./preflight.ts";
import { askViaSelector } from "./selector.ts";
import { type CallTarget, deriveTarget } from "./targets.ts";
import { TypingMonitor } from "./typing.ts";

/** Message namespace and the name in every user-facing string. */
const NAME = "pi-ask-permission";

const TYPING_STATUS = "waiting for you to finish typing";

type PersistedScope = Exclude<GrantScope, "session">;

function grantPath(scope: PersistedScope, cwd: string): string {
	return scope === "global" ? grantsPath() : projectGrantsPath(cwd, CONFIG_DIR_NAME);
}

export default function piAskPermission(pi: ExtensionAPI) {
	const loaded = loadConfig();
	const config = loaded.config;

	/** Grants by scope. Session is memory only; the other two mirror their file. */
	const grants: Record<GrantScope, Set<string>> = {
		session: new Set(),
		project: new Set(),
		global: new Set(),
	};
	/** Approval notes waiting for their tool result, keyed by tool call id. */
	const pendingNotes = new Map<string, string>();
	const typing = new TypingMonitor(config.typing.pause, config.typing.maxWait);

	const isGranted = (toolName: string, levels: string[]): boolean =>
		levels.some((level) => {
			const key = grantKey(toolName, level);
			return grants.session.has(key) || grants.project.has(key) || grants.global.has(key);
		});

	const persist = (ctx: ExtensionContext, scope: PersistedScope): void => {
		const error = saveGrants(grantPath(scope, ctx.cwd), grants[scope]);
		if (error) ctx.ui.notify(`${NAME}: could not save grants: ${error}`, "error");
	};

	const forget = (ctx: ExtensionContext, scope: GrantScope | "all"): number => {
		const targets = scope === "all" ? GRANT_SCOPES : [scope];
		let removed = 0;

		for (const target of targets) {
			removed += grants[target].size;
			grants[target].clear();
			if (target === "session") continue;

			const error = deleteGrants(grantPath(target, ctx.cwd));
			if (error) ctx.ui.notify(`${NAME}: could not delete grants: ${error}`, "error");
		}

		return removed;
	};

	/**
	 * Reloads the two persisted scopes. The project file is read only for a
	 * trusted project, so a repository cannot widen its own permissions.
	 */
	const loadScopes = (ctx: ExtensionContext): void => {
		grants.session.clear();
		grants.global = loadScope(ctx, grantsPath());

		const projectFile = projectGrantsPath(ctx.cwd, CONFIG_DIR_NAME);
		if (ctx.isProjectTrusted()) {
			grants.project = loadScope(ctx, projectFile);
			return;
		}

		grants.project = new Set();
		if (grantsFileExists(projectFile)) {
			ctx.ui.notify(`${NAME}: ${projectFile} skipped, this project is not trusted`, "warning");
		}
	};

	pi.on("session_start", (_event, ctx) => {
		for (const warning of loaded.warnings) ctx.ui.notify(`${NAME}: ${warning}`, "warning");
		loadScopes(ctx);
		typing.start(ctx);
	});

	pi.on("session_shutdown", () => {
		typing.stop();
	});

	pi.on("tool_call", async (event, ctx) => {
		if (config.yolo) return undefined;

		const toolName = event.toolName;
		if (isAllowed(config, toolName)) return undefined;

		const target = deriveTarget(toolName, event.input);
		if (isGranted(toolName, target.levels)) return undefined;

		if (!ctx.hasUI) return headlessRefusal(config, toolName);

		// An edit that cannot apply fails either way, so block it instead of asking.
		if (isToolCallEventType("edit", event)) {
			const failure = await editFailure(ctx, event.input);
			if (failure) return { block: true, reason: failure };
		}

		await typing.waitUntilQuiet(ctx.signal, (waiting) => {
			ctx.ui.setStatus(NAME, waiting ? TYPING_STATUS : undefined);
		});

		typing.pause();
		const decision = await ask(ctx, toolName, target).finally(() => typing.resume());

		if (decision.decision === "deny") {
			return { block: true, reason: denyReason(decision.note) };
		}

		if (decision.remember) {
			const scope = decision.scope ?? "session";
			grants[scope].add(grantKey(toolName, decision.remember));
			if (scope !== "session") persist(ctx, scope);

			const where = SCOPE_LABEL[scope];
			ctx.ui.notify(
				`${NAME}: always yes for ${toolName} \u00b7 ${decision.remember} (${where})`,
				"info",
			);
		}

		if (decision.note) {
			if (config.followup === "message") sendNote(pi, decision.note, toolName);
			else pendingNotes.set(event.toolCallId, decision.note);
		}

		return undefined;
	});

	// "result" appends the note to the tool output the model already reads.
	pi.on("tool_result", (event) => {
		const note = pendingNotes.get(event.toolCallId);
		if (!note) return undefined;

		pendingNotes.delete(event.toolCallId);
		return { content: [...event.content, { type: "text", text: noteBlock(note) }] };
	});

	pi.registerCommand("perm", {
		description: `${NAME}: settings, status, reset`,
		handler: async (args, ctx) => {
			const [verb, argument] = args.trim().toLowerCase().split(/\s+/);

			if (verb === "reset") {
				const target = argument ?? "session";
				if (!isResetTarget(target)) {
					ctx.ui.notify(`${NAME}: reset takes session, project, global, or all`, "warning");
					return;
				}

				const where = target === "all" ? "every scope" : SCOPE_LABEL[target];
				ctx.ui.notify(`${NAME}: forgot ${grantCount(forget(ctx, target))} from ${where}`, "info");
				return;
			}

			if (verb === "status" || ctx.mode !== "tui") {
				ctx.ui.notify(statusText(config, grants, loaded.path, ctx.cwd), "info");
				return;
			}

			await openSettings(ctx, {
				config,
				grants,
				save: () => {
					const error = saveConfig(config);
					if (error) ctx.ui.notify(`${NAME}: could not save config: ${error}`, "error");
				},
			});
		},
	});
}

interface SettingsState {
	config: AskConfig;
	grants: Record<GrantScope, Set<string>>;
	save: () => void;
}

async function openSettings(ctx: ExtensionContext, state: SettingsState): Promise<void> {
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
			currentValue: typeof state.config.headless === "string" ? state.config.headless : "per tool",
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
		container.addChild(
			new Text(
				theme.fg("accent", theme.bold(NAME)) +
					theme.fg("dim", `  \u00b7  ${grantCount(totalGrants(state.grants))} held`),
				1,
				1,
			),
		);

		const settings = new SettingsList(
			items,
			items.length + 2,
			getSettingsListTheme(),
			(id, newValue) => {
				if (id === "followup" && isFollowupWire(newValue)) state.config.followup = newValue;
				else if (id === "headless" && isHeadlessMode(newValue)) state.config.headless = newValue;
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

function headlessRefusal(
	config: AskConfig,
	toolName: string,
): { block: true; reason: string } | undefined {
	if (headlessMode(config, toolName) === "allow") return undefined;
	return { block: true, reason: `${NAME}: no UI available to approve "${toolName}"` };
}

function sendNote(pi: ExtensionAPI, note: string, toolName: string): void {
	void pi.sendMessage(
		{
			customType: NAME,
			content: noteBlock(note),
			display: true,
			details: { toolName },
		},
		{ deliverAs: "steer" },
	);
}

function noteBlock(note: string): string {
	return `[${NAME}] the user approved this call and added:\n${note}`;
}

function denyReason(note?: string): string {
	return note ? `${NAME}: denied by the user.\n${note}` : `${NAME}: denied by the user.`;
}

function isGrantScope(value: string): value is GrantScope {
	return GRANT_SCOPES.some((scope) => scope === value);
}

function isResetTarget(value: string): value is GrantScope | "all" {
	return value === "all" || isGrantScope(value);
}

function loadScope(ctx: ExtensionContext, path: string): Set<string> {
	const loaded = loadGrants(path);
	if (loaded.warning) ctx.ui.notify(`${NAME}: ${loaded.warning}`, "warning");
	return loaded.grants;
}

function grantCount(count: number): string {
	return `${count} grant${count === 1 ? "" : "s"}`;
}

function totalGrants(grants: Record<GrantScope, Set<string>>): number {
	return GRANT_SCOPES.reduce((total, scope) => total + grants[scope].size, 0);
}

function statusText(
	config: AskConfig,
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
		`grants: ${GRANT_SCOPES.map((scope) => `${grants[scope].size} ${scope}`).join(" \u00b7 ")}`,
		`project file: ${projectGrantsPath(cwd, CONFIG_DIR_NAME)}`,
		`global file: ${grantsPath()}`,
	].join("\n");
}
