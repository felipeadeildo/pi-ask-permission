import { CONFIG_DIR_NAME, type ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { PermissionConfig } from "#core/config/schema.ts";
import { grantsPath, loadConfig, projectGrantsPath, saveConfig } from "#core/config/store.ts";
import {
	deleteGrants,
	GRANT_SCOPES,
	type GrantScope,
	grantKey,
	grantsFileExists,
	loadGrants,
	saveGrants,
} from "#core/grants.ts";
import type { JudgeOutcome, JudgeRecord } from "#core/judge/types.ts";
import type { PermissionMode } from "#core/mode.ts";
import { createToolRegistry, type ToolRegistry } from "#core/tools.ts";
import { NAME } from "#identity";
import { TypingMonitor } from "#ui/typing.ts";

const JUDGE_FAILURE_LIMIT = 2;
const JUDGE_RETRY_MS = 60_000;

export interface JudgeHealth {
	failures: number;

	retryAt: number;
}

export interface SessionState {
	config: PermissionConfig;
	/** Effective mode for this session; `config.mode` is only the on-disk default. */
	mode: PermissionMode;
	configFile: string;
	configWarnings: string[];
	grants: Record<GrantScope, Set<string>>;
	pendingNotes: Map<string, string>;
	judgeCache: Map<string, JudgeOutcome>;
	judgeLog: JudgeRecord[];
	judgeWarned: Set<string>;
	judgeHealth: JudgeHealth;
	typing: TypingMonitor;
	tools: ToolRegistry;
}

export function createSession(): SessionState {
	const loaded = loadConfig();

	return {
		config: loaded.config,
		mode: loaded.config.mode,
		configFile: loaded.path,
		configWarnings: loaded.warnings,
		grants: { session: new Set(), project: new Set(), global: new Set() },
		pendingNotes: new Map(),
		judgeCache: new Map(),
		judgeLog: [],
		judgeWarned: new Set(),
		judgeHealth: { failures: 0, retryAt: 0 },
		typing: new TypingMonitor(loaded.config.typing.pause, loaded.config.typing.maxWait),
		tools: createToolRegistry(),
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

type PersistedScope = Exclude<GrantScope, "session">;

function grantPath(scope: PersistedScope, cwd: string): string {
	return scope === "global" ? grantsPath() : projectGrantsPath(cwd, CONFIG_DIR_NAME);
}

export function saveConfigFile(state: SessionState, ctx: ExtensionContext): void {
	const error = saveConfig(state.config);
	if (error) ctx.ui.notify(`${NAME}: could not save config: ${error}`, "error");
}

export function isGranted(state: SessionState, toolName: string, grantLevels: string[]): boolean {
	return grantLevels.some((level) => {
		const key = grantKey(toolName, level);
		return (
			state.grants.session.has(key) || state.grants.project.has(key) || state.grants.global.has(key)
		);
	});
}

export function persistGrants(
	state: SessionState,
	ctx: ExtensionContext,
	scope: PersistedScope,
): void {
	const error = saveGrants(grantPath(scope, ctx.cwd), state.grants[scope]);
	if (error) ctx.ui.notify(`${NAME}: could not save grants: ${error}`, "error");
}

export function forgetGrants(
	state: SessionState,
	ctx: ExtensionContext,
	scope: GrantScope | "all",
): number {
	const targets = scope === "all" ? GRANT_SCOPES : [scope];
	let removed = 0;

	for (const target of targets) {
		removed += state.grants[target].size;
		state.grants[target].clear();
		if (target === "session") continue;

		const error = deleteGrants(grantPath(target, ctx.cwd));
		if (error) ctx.ui.notify(`${NAME}: could not delete grants: ${error}`, "error");
	}

	return removed;
}

export function loadGrantScopes(state: SessionState, ctx: ExtensionContext): void {
	state.grants.session.clear();
	state.grants.global = loadScope(ctx, grantsPath());

	const projectFile = projectGrantsPath(ctx.cwd, CONFIG_DIR_NAME);
	if (ctx.isProjectTrusted()) {
		state.grants.project = loadScope(ctx, projectFile);
		return;
	}

	state.grants.project = new Set();
	if (grantsFileExists(projectFile)) {
		ctx.ui.notify(`${NAME}: ${projectFile} skipped, this project is not trusted`, "warning");
	}
}

function loadScope(ctx: ExtensionContext, path: string): Set<string> {
	const loaded = loadGrants(path);
	if (loaded.warning) ctx.ui.notify(`${NAME}: ${loaded.warning}`, "warning");
	return loaded.grants;
}
