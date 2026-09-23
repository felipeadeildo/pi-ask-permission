import { matchesPattern } from "#core/config/patterns.ts";
import type { JudgeConfig } from "#core/judge/config.ts";
import type { JudgeAnswers } from "#core/judge/types.ts";

export const RISK_WEIGHTS = {
	reversibility: 0.6,
	sensitive: 0.4,
} as const;

export function alwaysAskMatches(config: JudgeConfig, values: string[]): boolean {
	return config.alwaysAsk.some((pattern) => values.some((value) => matchesPattern(pattern, value)));
}

// The old 0.45 to 0.30 ratio, once the workspace term moves out.
export function judgeRisk(answers: JudgeAnswers): number | undefined {
	const { reversibility, sensitive_access } = answers;
	if (reversibility === undefined || sensitive_access === undefined) return undefined;

	return (
		RISK_WEIGHTS.reversibility * clamp01(reversibility / 2) +
		RISK_WEIGHTS.sensitive * clamp01(sensitive_access)
	);
}

export type JudgeDecision = "allow" | "deny" | "uncertain";

export interface ComposedVerdict {
	decision: JudgeDecision;
	reason: string;
	risk?: number;
}

export function composeVerdict(config: JudgeConfig, answers: JudgeAnswers): ComposedVerdict {
	const verdict = answers.verdict;
	if (!verdict) return { decision: "uncertain", reason: "the judge returned no verdict" };

	if (verdict.choice === "needs_human")
		return { decision: "uncertain", reason: "the judge asked for a person to decide" };

	if (verdict.choice === "deny") {
		if (!config.canDeny)
			return {
				decision: "uncertain",
				reason: `the judge denied this call, but judge.canDeny is off (${percent(verdict.confidence)} confident)`,
			};
		if (verdict.confidence >= config.thresholds.deny)
			return {
				decision: "deny",
				reason: `the judge denied this call (${percent(verdict.confidence)} confident)`,
			};
		return {
			decision: "uncertain",
			reason: `the judge leaned deny but was only ${percent(verdict.confidence)} confident`,
		};
	}

	const risk = judgeRisk(answers);
	if (risk === undefined)
		return {
			decision: "uncertain",
			reason: "the judge did not return enough risk signals",
		};

	if (verdict.confidence < config.thresholds.allow)
		return {
			decision: "uncertain",
			reason: `the judge approved but was only ${percent(verdict.confidence)} confident`,
			risk,
		};

	if (risk > config.riskCeiling)
		return {
			decision: "uncertain",
			reason: `composed risk ${risk.toFixed(2)} is above the ceiling`,
			risk,
		};

	return {
		decision: "allow",
		reason: `the judge approved this call (${percent(verdict.confidence)} confident, risk ${risk.toFixed(2)})`,
		risk,
	};
}

function percent(value: number): string {
	return `${Math.round(clamp01(value) * 100)}%`;
}

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}
