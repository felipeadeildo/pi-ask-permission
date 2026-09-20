/** Config types and defaults. No file access, no validation, no pi. */

export type HeadlessMode = "allow" | "deny";

export type FollowupDelivery = "result" | "message";

export interface TypingConfig {
	pause: number;
	/** null waits as long as the user keeps typing. */
	maxWait: number | null;
}

export type JudgeBackendId = "jev" | "pi";

export type JudgeFallback = "ask" | "allow" | "deny";

export interface JudgeThresholds {
	allow: number;
	deny: number;
}

export interface JudgeConfig {
	enabled: boolean;
	backend: JudgeBackendId;
	/** `jev` alias or pinned id, or `provider/modelId` for the `pi` backend. */
	model: string;
	/** Tool patterns the judge may decide. Empty means it never runs. */
	tools: string[];
	/** Patterns it may never auto-approve, whatever it answers. */
	never: string[];
	thresholds: JudgeThresholds;
	intentFloor: number;
	riskCeiling: number;
	onUncertain: JudgeFallback;
	autoDeny: boolean;
	onError: JudgeFallback;
	/** Also judge print, JSON, and subagent runs. */
	headless: boolean;
	/** Show the verdict but still ask. */
	dryRun: boolean;
	/** Remember judge approvals for the session. */
	grant: boolean;
	timeoutMs: number;
	cache: boolean;
	/** Send the last user message so intent can be judged. */
	includeConversation: boolean;
	/** Operator rulebook for what may run. */
	policy: string;
}

export interface PermissionConfig {
	/** Tool patterns that never prompt. `*` and `?` work. */
	allow: string[];
	headless: HeadlessMode | Record<string, HeadlessMode>;
	followup: FollowupDelivery;
	yolo: boolean;
	readOnlyBash: boolean;
	typing: TypingConfig;
	judge: JudgeConfig;
}

export const DEFAULT_TYPING: TypingConfig = {
	pause: 1000,
	maxWait: null,
};

export const DEFAULT_JUDGE: JudgeConfig = {
	enabled: false,
	backend: "jev",
	model: "jev-latest",
	tools: ["bash"],
	never: [],
	thresholds: { allow: 0.85, deny: 0.8 },
	intentFloor: 0.6,
	riskCeiling: 0.45,
	onUncertain: "ask",
	autoDeny: true,
	onError: "ask",
	headless: false,
	dryRun: false,
	grant: false,
	timeoutMs: 5000,
	cache: true,
	includeConversation: true,
	policy: "",
};

export const DEFAULT_CONFIG: PermissionConfig = {
	allow: ["read", "grep", "find", "ls"],
	headless: "deny",
	followup: "result",
	yolo: false,
	readOnlyBash: true,
	typing: DEFAULT_TYPING,
	judge: DEFAULT_JUDGE,
};

/** Fresh copies, so a decoded config never aliases the exported defaults. */
export function defaultJudge(): JudgeConfig {
	return {
		...DEFAULT_JUDGE,
		thresholds: { ...DEFAULT_JUDGE.thresholds },
		tools: [...DEFAULT_JUDGE.tools],
		never: [...DEFAULT_JUDGE.never],
	};
}

export function defaultConfig(): PermissionConfig {
	return {
		...DEFAULT_CONFIG,
		allow: [...DEFAULT_CONFIG.allow],
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
