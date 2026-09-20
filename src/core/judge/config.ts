import { DEFAULT_POLICY } from "#core/judge/policy.ts";

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
	/** Operator rulebook for what may run. */
	policy: string;
}

export const DEFAULT_JUDGE: JudgeConfig = {
	enabled: false,
	backend: "jev",
	model: "jev-latest",
	tools: ["bash"],
	never: [],
	thresholds: { allow: 0.85, deny: 0.8 },
	riskCeiling: 0.45,
	onUncertain: "ask",
	autoDeny: true,
	onError: "ask",
	headless: false,
	dryRun: false,
	grant: false,
	timeoutMs: 5000,
	cache: true,
	policy: DEFAULT_POLICY,
};

export function defaultJudge(): JudgeConfig {
	return {
		...DEFAULT_JUDGE,
		thresholds: { ...DEFAULT_JUDGE.thresholds },
		tools: [...DEFAULT_JUDGE.tools],
		never: [...DEFAULT_JUDGE.never],
	};
}
