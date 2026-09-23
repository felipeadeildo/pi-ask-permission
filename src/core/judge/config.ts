import { DEFAULT_POLICY } from "#core/judge/policy.ts";

export type JudgeBackendId = "jev" | "pi";

export type JudgeFallback = "ask" | "allow" | "deny";

export interface JudgeThresholds {
	allow: number;
	deny: number;
}

export interface JudgeConfig {
	enabled: boolean;
	provider: JudgeBackendId;
	/** A Jev alias or pinned id, or `provider/modelId` for a pi model. */
	model: string;
	/** Tool patterns the judge may decide. Empty means it never runs. */
	tools: string[];
	alwaysAsk: string[];
	thresholds: JudgeThresholds;
	riskCeiling: number;
	whenUnsure: JudgeFallback;
	canDeny: boolean;
	whenItFails: JudgeFallback;
	noUI: boolean;
	dryRun: boolean;
	rememberApprovals: boolean;
	timeoutMs: number;
	cache: boolean;
	/** Operator rulebook for what may run. */
	policy: string;
}

export const DEFAULT_JUDGE: JudgeConfig = {
	enabled: false,
	provider: "jev",
	model: "jev-latest",
	tools: ["bash"],
	alwaysAsk: [],
	thresholds: { allow: 0.85, deny: 0.8 },
	riskCeiling: 0.45,
	whenUnsure: "ask",
	canDeny: true,
	whenItFails: "ask",
	noUI: false,
	dryRun: false,
	rememberApprovals: false,
	timeoutMs: 5000,
	cache: true,
	policy: DEFAULT_POLICY,
};

export function defaultJudge(): JudgeConfig {
	return {
		...DEFAULT_JUDGE,
		thresholds: { ...DEFAULT_JUDGE.thresholds },
		tools: [...DEFAULT_JUDGE.tools],
		alwaysAsk: [...DEFAULT_JUDGE.alwaysAsk],
	};
}
