import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";

import { type Scope, SCOPE_LABEL, SCOPES } from "#core/always-yes.ts";
import { TYPESAFE_PROVIDER } from "#core/judge/backends/jev.ts";
import { probeJudge } from "#core/judge/probe.ts";
import { judgeLogText } from "#core/judge/report.ts";
import { MODE_LABEL, nextMode, parseMode } from "#core/mode.ts";
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
		ctx.ui.notify(
			statusText(state.config, state.alwaysYes, state.configFile, ctx.cwd, state.mode),
			"info",
		);
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

		if (argument === "status" || ctx.mode !== "tui") {
			notifyStatus(ctx);
			return;
		}

		await openSettingsFor(ctx);
	}

	function modeCommand(ctx: ExtensionContext, argument: string | undefined): void {
		if (argument === undefined) {
			cycleMode(ctx);
			return;
		}

		const mode = parseMode(argument);
		if (!mode) {
			ctx.ui.notify(`${NAME}: mode takes ${Object.values(MODE_LABEL).join(", ")}`, "warning");
			return;
		}

		setSessionMode(pi, state, mode, ctx);
	}

	pi.registerCommand("perm", {
		description: `${NAME}: mode, settings, status, reset`,
		handler: async (args, ctx) => {
			const [verb, argument] = args.trim().toLowerCase().split(/\s+/);

			if (verb === "judge") {
				await judgeCommand(ctx, argument);
				return;
			}

			if (verb === "mode") {
				modeCommand(ctx, argument);
				return;
			}

			if (verb === "reset") {
				const target = argument ?? "session";
				if (!isResetTarget(target)) {
					ctx.ui.notify(`${NAME}: reset takes session, project, global, or all`, "warning");
					return;
				}

				const where = target === "all" ? "every scope" : SCOPE_LABEL[target];
				const removed = alwaysYesCount(forgetAlwaysYes(pi, state, ctx, target));
				ctx.ui.notify(`${NAME}: forgot ${removed} from ${where}`, "info");
				return;
			}

			if (verb === "status" || ctx.mode !== "tui") {
				notifyStatus(ctx);
				return;
			}

			await openSettingsFor(ctx);
		},
	});

	pi.registerShortcut(Key.alt("m"), {
		description: `${NAME}: cycle mode (manual, accept edits, auto)`,
		handler: cycleMode,
	});
}

function isResetTarget(value: string): value is Scope | "all" {
	return value === "all" || SCOPES.some((scope) => scope === value);
}
