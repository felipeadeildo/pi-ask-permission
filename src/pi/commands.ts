import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { GRANT_SCOPES, type GrantScope, SCOPE_LABEL } from "#core/grants.ts";
import { probeJudge, TYPESAFE_PROVIDER } from "#core/judge/index.ts";
import { judgeLogText } from "#core/judge/report.ts";
import { NAME } from "#identity";
import { forgetGrants, resetJudgeHealth, saveConfigFile, type SessionState } from "#pi/session.ts";
import { grantCount, openSettings } from "#ui/settings/screen.ts";
import { notifyJudgePolicyWarning, statusText } from "#ui/settings/status.ts";

const JUDGE_STATUS = `${NAME}:judge`;

export function registerCommands(pi: ExtensionAPI, state: SessionState): void {
	const openSettingsFor = (ctx: ExtensionContext): Promise<void> =>
		openSettings(ctx, {
			config: state.config,
			grants: state.grants,
			save: () => saveConfigFile(state, ctx),
			onJudgeChange: () => state.judgeCache.clear(),
		});

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
			const suffix = state.config.judge.backend === "jev" ? ` (${source})` : "";
			ctx.ui.notify(`${NAME}: judge test failed \u2014 ${probe.detail}${suffix}`, "error");
			return;
		}

		resetJudgeHealth(state);

		const summary = `judge test ok \u00b7 ${probe.model ?? state.config.judge.model} \u00b7 ${probe.elapsedMs}ms`;
		if (probe.elapsedMs > state.config.judge.timeoutMs) {
			ctx.ui.notify(
				`${NAME}: ${summary} \u2014 slower than the ${state.config.judge.timeoutMs}ms timeout, raise judge.timeoutMs`,
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
			ctx.ui.notify(`${NAME}: AI approvals ${argument}`, "info");
			return;
		}

		if (argument === "status" || ctx.mode !== "tui") {
			ctx.ui.notify(statusText(state.config, state.grants, state.configFile, ctx.cwd), "info");
			return;
		}

		await openSettingsFor(ctx);
	}

	pi.registerCommand("perm", {
		description: `${NAME}: settings, status, reset`,
		handler: async (args, ctx) => {
			const [verb, argument] = args.trim().toLowerCase().split(/\s+/);

			if (verb === "judge") {
				await judgeCommand(ctx, argument);
				return;
			}

			if (verb === "reset") {
				const target = argument ?? "session";
				if (!isResetTarget(target)) {
					ctx.ui.notify(`${NAME}: reset takes session, project, global, or all`, "warning");
					return;
				}

				const where = target === "all" ? "every scope" : SCOPE_LABEL[target];
				const removed = grantCount(forgetGrants(state, ctx, target));
				ctx.ui.notify(`${NAME}: forgot ${removed} from ${where}`, "info");
				return;
			}

			if (verb === "status" || ctx.mode !== "tui") {
				ctx.ui.notify(statusText(state.config, state.grants, state.configFile, ctx.cwd), "info");
				return;
			}

			await openSettingsFor(ctx);
		},
	});
}

function isGrantScope(value: string): value is GrantScope {
	return GRANT_SCOPES.some((scope) => scope === value);
}

function isResetTarget(value: string): value is GrantScope | "all" {
	return value === "all" || isGrantScope(value);
}
