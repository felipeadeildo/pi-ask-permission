import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { type AlwaysYes, SCOPE_LABEL, SCOPES } from "#core/always-yes.ts";
import type { PermissionConfig } from "#core/config/schema.ts";
import { globalAlwaysYesPath, projectAlwaysYesPath } from "#core/config/store.ts";
import { policyWarning } from "#core/judge/policy.ts";
import { MODE_LABEL, type PermissionMode } from "#core/mode.ts";
import { NAME } from "#identity";

export function notifyJudgePolicyWarning(config: PermissionConfig, ctx: ExtensionContext): void {
	if (!config.judge.enabled) return;

	const warning = policyWarning(config.judge.policy);
	if (warning) ctx.ui.notify(`${NAME}: ${warning}`, "warning");
}

export function statusText(
	config: PermissionConfig,
	alwaysYes: AlwaysYes,
	configFile: string,
	cwd: string,
	mode: PermissionMode,
): string {
	const headless =
		typeof config.headless === "string" ? config.headless : JSON.stringify(config.headless);

	return [
		`${NAME} \u00b7 ${configFile}`,
		`allow: ${config.allow.join(", ") || "(none)"}`,
		`mode: ${MODE_LABEL[mode]} (this session)`,
		`followup: ${config.followup} \u00b7 headless: ${headless}`,
		`typing: pause ${config.typing.pause}ms \u00b7 maxWait ${config.typing.maxWait ?? "none"}`,
		`readOnlyBash: ${config.readOnlyBash ? "on" : "off"}`,
		`workspace: ${config.workspace.roots.join(", ")} \u00b7 outside: ${config.workspace.outside}`,
		judgeLine(config),
		`always yes: ${SCOPES.map((scope) => `${alwaysYes.size(scope)} ${SCOPE_LABEL[scope]}`).join(" \u00b7 ")}`,
		`always yes for this project: ${projectAlwaysYesPath(cwd)}`,
		`always yes everywhere: ${globalAlwaysYesPath()}`,
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
