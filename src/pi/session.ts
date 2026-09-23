import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { AlwaysYes, savedFileExists, type Scope } from "#core/always-yes.ts";
import { defaultConfig, type PermissionConfig } from "#core/config/schema.ts";
import {
	globalAlwaysYesPath,
	loadConfig,
	projectAlwaysYesPath,
	saveConfig,
} from "#core/config/store.ts";
import type { JudgeOutcome, JudgeRecord } from "#core/judge/types.ts";
import type { PermissionMode } from "#core/mode.ts";
import type { ToolAdapter } from "#core/tools.ts";
import { NAME } from "#identity";
import type { PendingWrites } from "#pi/preview.ts";
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
	alwaysYes: AlwaysYes;
	pendingNotes: Map<string, string>;
	judgeCache: Map<string, JudgeOutcome>;
	judgeLog: JudgeRecord[];
	judgeWarned: Set<string>;
	judgeHealth: JudgeHealth;
	typing: TypingMonitor;
	customTools: Map<string, Partial<ToolAdapter>>;
	pendingWrites: PendingWrites;
}

export function createSession(): SessionState {
	const config = defaultConfig();

	return {
		config,
		mode: config.mode,
		alwaysYes: new AlwaysYes(),
		pendingNotes: new Map(),
		judgeCache: new Map(),
		judgeLog: [],
		judgeWarned: new Set(),
		judgeHealth: { failures: 0, retryAt: 0 },
		typing: new TypingMonitor(),
		customTools: new Map(),
		pendingWrites: new Map(),
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

// Read at every session start, so an edit to config.json applies from the next session.
export function loadSessionConfig(state: SessionState, ctx: ExtensionContext): void {
	const loaded = loadConfig();
	state.config = loaded.config;
	for (const warning of loaded.warnings) ctx.ui.notify(`${NAME}: ${warning}`, "warning");
	if (loaded.updated) ctx.ui.notify(`${NAME}: config.json updated to the 3.0 names`, "info");

	state.typing.stop();
	state.typing = new TypingMonitor(loaded.config.typing.pause, loaded.config.typing.maxWait);
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
