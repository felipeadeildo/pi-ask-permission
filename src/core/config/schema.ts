import { DEFAULT_JUDGE, defaultJudge, type JudgeConfig } from "#core/judge/config.ts";
import { DEFAULT_MODE, type PermissionMode } from "#core/mode.ts";

export type HeadlessMode = "allow" | "deny";

export type FollowupDelivery = "result" | "message";

export type OutsideScope = "ask" | "deny" | "allow";

export interface WorkspaceConfig {
	roots: string[];
	outside: OutsideScope;
}

export interface TypingConfig {
	pause: number;
	maxWait: number | null;
}

export interface PermissionConfig {
	allow: string[];
	headless: HeadlessMode | Record<string, HeadlessMode>;
	followup: FollowupDelivery;
	mode: PermissionMode;
	readOnlyBash: boolean;
	workspace: WorkspaceConfig;
	typing: TypingConfig;
	judge: JudgeConfig;
}

export const DEFAULT_TYPING: TypingConfig = {
	pause: 1000,
	maxWait: null,
};

export const DEFAULT_WORKSPACE: WorkspaceConfig = {
	roots: ["."],
	outside: "ask",
};

export const DEFAULT_CONFIG: PermissionConfig = {
	allow: ["read", "grep", "find", "ls"],
	headless: "deny",
	followup: "result",
	mode: DEFAULT_MODE,
	readOnlyBash: true,
	workspace: DEFAULT_WORKSPACE,
	typing: DEFAULT_TYPING,
	judge: DEFAULT_JUDGE,
};

export function defaultConfig(): PermissionConfig {
	return {
		...DEFAULT_CONFIG,
		allow: [...DEFAULT_CONFIG.allow],
		workspace: { ...DEFAULT_WORKSPACE, roots: [...DEFAULT_WORKSPACE.roots] },
		typing: { ...DEFAULT_CONFIG.typing },
		judge: defaultJudge(),
	};
}

export function isHeadlessMode(value: unknown): value is HeadlessMode {
	return value === "allow" || value === "deny";
}

export function isFollowupDelivery(value: unknown): value is FollowupDelivery {
	return value === "result" || value === "message";
}

export function isOutsideScope(value: unknown): value is OutsideScope {
	return value === "ask" || value === "deny" || value === "allow";
}
