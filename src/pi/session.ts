import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { AlwaysYes, savedFileExists, type Scope } from "#core/always-yes.ts";
import type { PermissionConfig } from "#core/config/schema.ts";
import {
	globalAlwaysYesPath,
	loadConfig,
	projectAlwaysYesPath,
	saveConfig,
} from "#core/config/store.ts";
import type { JudgeOutcome, JudgeRecord } from "#core/judge/types.ts";
import type { PermissionMode } from "#core/mode.ts";
import { NAME } from "#identity";
import { record } from "#pi/session-entries.ts";
import { TypingMonitor } from "#ui/typing.ts";

const JUDGE_FAILURE_LIMIT = 2;
const JUDGE_RETRY_MS = 60_000;

export interface JudgeHealth {
	failures: number;
	retryAt: number;
}

export interface SessionState {
	config: PermissionConfig;
	mode: PermissionMode;
	configFile: string;
	configWarnings: string[];
	alwaysYes: AlwaysYes;
	pendingNotes: Map<string, string>;
	judgeCache: Map<string, JudgeOutcome>;
	judgeLog: JudgeRecord[];
	judgeWarned: Set<string>;
	judgeHealth: JudgeHealth;
	typing: TypingMonitor;
}

export function createSession(): SessionState {
	const loaded = loadConfig();

	return {
		config: loaded.config,
		mode: loaded.config.mode,
		configFile: loaded.path,
		configWarnings: loaded.warnings,
		alwaysYes: new AlwaysYes(),
		pendingNotes: new Map(),
		judgeCache: new Map(),
		judgeLog: [],
		judgeWarned: new Set(),
		judgeHealth: { failures: 0, retryAt: 0 },
		typing: new TypingMonitor(loaded.config.typing.pause, loaded.config.typing.maxWait),
	};
}

export function resetJudgeHealth(state: SessionState): void {
	state.judgeHealth.failures = 0;
	state.judgeHealth.retryAt = 0;
}

export function noteJudgeFailure(state: SessionState, ctx: ExtensionContext): void {
	state.judgeHealth.failures++;
	if (state.judgeHealth.failures < JUDGE_FAILURE_LIMIT) return;

	state.judgeHealth.failures = 0;
	state.judgeHealth.retryAt = Date.now() + JUDGE_RETRY_MS;
	ctx.ui.notify(
		`${NAME}: judge paused for ${JUDGE_RETRY_MS / 1000}s after repeated failures; run /perm judge test`,
		"warning",
	);
}

export function saveConfigFile(state: SessionState, ctx: ExtensionContext): void {
	const error = saveConfig(state.config);
	if (error) ctx.ui.notify(`${NAME}: could not save config: ${error}`, "error");
}

export function openAlwaysYes(state: SessionState, ctx: ExtensionContext): void {
	const project = projectAlwaysYesPath(ctx.cwd);
	const trusted = ctx.isProjectTrusted();
	const warnings = state.alwaysYes.open({
		global: globalAlwaysYesPath(),
		project: trusted ? project : undefined,
	});

	for (const warning of warnings) ctx.ui.notify(`${NAME}: ${warning}`, "warning");
	if (!trusted && savedFileExists(project)) {
		ctx.ui.notify(`${NAME}: ${project} skipped, this project is not trusted`, "warning");
	}
}

export function rememberAlwaysYes(
	pi: ExtensionAPI,
	state: SessionState,
	ctx: ExtensionContext,
	scope: Scope,
	toolName: string,
	level: string,
): void {
	if (scope === "session") record(pi, { kind: "always-yes", toolName, level });
	const problem = state.alwaysYes.add(scope, toolName, level);
	if (problem) ctx.ui.notify(`${NAME}: could not save always yes: ${problem}`, "warning");
}

export function forgetAlwaysYes(
	pi: ExtensionAPI,
	state: SessionState,
	ctx: ExtensionContext,
	scope: Scope | "all",
): number {
	if (scope === "session" || scope === "all") record(pi, { kind: "forget-always-yes" });
	const { removed, errors } = state.alwaysYes.forget(scope);
	for (const error of errors)
		ctx.ui.notify(`${NAME}: could not delete always yes: ${error}`, "error");
	return removed;
}
