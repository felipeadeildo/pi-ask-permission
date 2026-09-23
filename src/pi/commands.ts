import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type AutocompleteItem, Key } from "@earendil-works/pi-tui";

import { type Scope, SCOPE_LABEL } from "#core/always-yes.ts";
import { TYPESAFE_PROVIDER } from "#core/judge/backends/jev.ts";
import { probeJudge } from "#core/judge/probe.ts";
import { judgeLogText } from "#core/judge/report.ts";
import { MODE_DESCRIPTION, nextMode, parseMode, PERMISSION_MODES } from "#core/mode.ts";
import { NAME } from "#identity";
import { setSessionMode } from "#pi/mode.ts";
import {
	forgetAlwaysYes,
	resetJudgeHealth,
	saveConfigFile,
	type SessionState,
} from "#pi/session.ts";
import { alwaysYesCount, openSettings } from "#ui/settings/screen.ts";
import { notifyJudgePolicyWarning, statusText } from "#ui/settings/status.ts";

const JUDGE_STATUS = `${NAME}:judge`;

export function registerCommands(pi: ExtensionAPI, state: SessionState): void {
	const openSettingsFor = (ctx: ExtensionContext): Promise<void> =>
		openSettings(ctx, {
			config: state.config,
			alwaysYes: state.alwaysYes,
			mode: () => state.mode,
			setMode: (mode) => setSessionMode(pi, state, mode, ctx, false),
			save: () => saveConfigFile(state, ctx),
			onJudgeChange: () => state.judgeCache.clear(),
		});

	function notifyStatus(ctx: ExtensionContext): void {
		ctx.ui.notify(statusText(state.config, state.alwaysYes, ctx.cwd, state.mode), "info");
	}

	function cycleMode(ctx: ExtensionContext): void {
		setSessionMode(pi, state, nextMode(state.mode), ctx);
	}

	async function runJudgeProbe(ctx: ExtensionContext): Promise<void> {
		ctx.ui.setStatus(JUDGE_STATUS, "judge: testing\u2026");
		const auth = ctx.modelRegistry.getProviderAuthStatus(TYPESAFE_PROVIDER);
		const probe = await probeJudge(
			state.config.judge,
			{
				resolveApiKey: () => ctx.modelRegistry.getApiKeyForProvider(TYPESAFE_PROVIDER),
				modelRegistry: ctx.modelRegistry,
			},
			ctx.signal,
		).finally(() => ctx.ui.setStatus(JUDGE_STATUS, undefined));

		if (!probe.ok) {
			const source = auth.configured
				? `key from ${auth.label ?? auth.source}`
				: "no key configured";
			const suffix = state.config.judge.provider === "jev" ? ` (${source})` : "";
			ctx.ui.notify(`${NAME}: judge test failed: ${probe.detail}${suffix}`, "error");
			return;
		}

		resetJudgeHealth(state);

		const summary = `judge test ok \u00b7 ${probe.model ?? state.config.judge.model} \u00b7 ${probe.elapsedMs}ms`;
		if (probe.elapsedMs > state.config.judge.timeoutMs) {
			ctx.ui.notify(
				`${NAME}: ${summary}. Slower than the ${state.config.judge.timeoutMs}ms timeout, raise judge.timeoutMs`,
				"warning",
			);
			return;
		}

		ctx.ui.notify(`${NAME}: ${summary}`, "info");
	}

	async function judgeCommand(ctx: ExtensionContext, argument: string | undefined): Promise<void> {
		if (argument === "log") {
			ctx.ui.notify(judgeLogText(state.judgeLog), "info");
			return;
		}

		if (argument === "test") {
			await runJudgeProbe(ctx);
			return;
		}

		if (argument === "on" || argument === "off") {
			state.config.judge.enabled = argument === "on";
			saveConfigFile(state, ctx);
			state.judgeCache.clear();
			if (argument === "on") {
				resetJudgeHealth(state);
				notifyJudgePolicyWarning(state.config, ctx);
			}
			ctx.ui.notify(`${NAME}: judge ${argument}`, "info");
			return;
		}

		await settingsOrStatus(ctx);
	}

	function modeCommand(ctx: ExtensionContext, argument: string | undefined): void {
		if (argument === undefined) {
			cycleMode(ctx);
			return;
		}

		const mode = parseMode(argument);
		if (!mode) {
			ctx.ui.notify(`${NAME}: mode takes ${PERMISSION_MODES.join(", ")}`, "warning");
			return;
		}

		setSessionMode(pi, state, mode, ctx);
	}

	function forgetCommand(ctx: ExtensionContext, argument = "session"): void {
		const scope = FORGET_SCOPES[argument];
		if (!scope) {
			ctx.ui.notify(`${NAME}: forget takes ${Object.keys(FORGET_SCOPES).join(", ")}`, "warning");
			return;
		}

		const where = scope === "all" ? "every scope" : SCOPE_LABEL[scope];
		const removed = alwaysYesCount(forgetAlwaysYes(pi, state, ctx, scope));
		ctx.ui.notify(`${NAME}: forgot ${removed} from ${where}`, "info");
	}

	async function settingsOrStatus(ctx: ExtensionContext): Promise<void> {
		if (ctx.mode === "tui") await openSettingsFor(ctx);
		else notifyStatus(ctx);
	}

	pi.registerCommand("perm", {
		description: `${NAME}: settings, mode, status, forget, judge`,
		getArgumentCompletions: (prefix) => {
			const typed = prefix.trimStart().toLowerCase();
			const matches = SUBCOMMANDS.filter((command) => command.value.startsWith(typed));
			return matches.length > 0 ? matches : null;
		},
		handler: async (args, ctx) => {
			const [verb, argument] = args.trim().toLowerCase().split(/\s+/);

			switch (verb) {
				case "":
					await settingsOrStatus(ctx);
					return;
				case "mode":
					modeCommand(ctx, argument);
					return;
				case "status":
					notifyStatus(ctx);
					return;
				case "forget":
					forgetCommand(ctx, argument);
					return;
				case "judge":
					await judgeCommand(ctx, argument);
					return;
				default:
					ctx.ui.notify(`${NAME}: /perm takes ${VERBS.join(", ")}`, "warning");
			}
		},
	});

	pi.registerShortcut(Key.alt("m"), {
		description: `${NAME}: cycle mode (manual, accept edits, auto)`,
		handler: cycleMode,
	});
}

const FORGET_SCOPES: Record<string, Scope | "all"> = {
	session: "session",
	project: "project",
	everywhere: "global",
	all: "all",
};

const SUBCOMMANDS: AutocompleteItem[] = [
	suggestion("mode", "Switch to the next mode (also Alt+M)"),
	...PERMISSION_MODES.map((mode) => suggestion(`mode ${mode}`, MODE_DESCRIPTION[mode])),
	suggestion("status", "Show the config, always yes, and file paths"),
	suggestion("forget", "Forget this session's always yes"),
	suggestion("forget project", "Forget this project's always yes"),
	suggestion("forget everywhere", "Forget the always yes that applies everywhere"),
	suggestion("forget all", "Forget every always yes"),
	suggestion("judge on", "Turn the judge on"),
	suggestion("judge off", "Turn the judge off"),
	suggestion("judge log", "Show this session's judge decisions"),
	suggestion("judge test", "Send one real request and report the result"),
];

function suggestion(value: string, description: string): AutocompleteItem {
	return { value, label: value, description };
}

const VERBS = ["mode", "status", "forget", "judge"];
