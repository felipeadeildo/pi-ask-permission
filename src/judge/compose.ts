/**
 * Deterministic composition. The judge supplies typed signals; this file turns
 * them into a decision with plain arithmetic, so the operator can read the rule
 * and change a number instead of rewriting a prompt.
 */
import { matchesPattern } from "../core/config/patterns.ts";
import type { JudgeConfig } from "../core/config/schema.ts";
import type { JudgeAnswers } from "./types.ts";

/** Relative weight of each risk signal. Reversibility dominates on purpose. */
export const RISK_WEIGHTS = {
	reversibility: 0.45,
	sensitive: 0.3,
	outside: 0.25,
} as const;

export function neverMatches(config: JudgeConfig, values: string[]): boolean {
	return config.never.some((pattern) => values.some((value) => matchesPattern(pattern, value)));
}

/**
 * Weighted risk in 0..1. Undefined when any signal is missing, because a
 * partial picture must not be treated as a safe one.
 */
export function judgeRisk(answers: JudgeAnswers): number | undefined {
	const { reversibility, sensitive_access, outside_workspace } = answers;
	if (
		reversibility === undefined ||
		sensitive_access === undefined ||
		outside_workspace === undefined
	)
		return undefined;

	return (
		RISK_WEIGHTS.reversibility * clamp01(reversibility / 2) +
		RISK_WEIGHTS.sensitive * clamp01(sensitive_access) +
		RISK_WEIGHTS.outside * clamp01(outside_workspace)
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
		if (!config.autoDeny)
			return {
				decision: "uncertain",
				reason: `the judge denied this call, but auto-deny is off (${percent(verdict.confidence)} confident)`,
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

	const intent = answers.intent_match;
	if (intent === undefined)
		return {
			decision: "uncertain",
			reason: "the judge did not report whether the call serves you",
			risk,
		};

	if (intent < config.intentFloor)
		return {
			decision: "uncertain",
			reason: `the call may not serve your request (intent ${intent.toFixed(2)})`,
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
