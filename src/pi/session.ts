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
import type { JudgeOutcome, JudgeRecord } from "#core/judge/index.ts";
import { NAME } from "#identity";
import { TypingMonitor } from "#ui/typing.ts";

export interface JudgeHealth {
	failures: number;
	/** Epoch ms before which the judge stays paused. */
	retryAt: number;
}

/** Everything one loaded session owns. Created once, handed to events and commands. */
export interface SessionState {
	config: PermissionConfig;
	configFile: string;
	configWarnings: string[];
	grants: Record<GrantScope, Set<string>>;
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
		configFile: loaded.path,
		configWarnings: loaded.warnings,
		grants: { session: new Set(), project: new Set(), global: new Set() },
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

/** The project file loads only for a trusted project, so a repo cannot widen itself. */
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
