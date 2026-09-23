import {
	DEFAULT_JUDGE,
	defaultJudge,
	type JudgeConfig,
	type JudgeThresholds,
} from "#core/judge/config.ts";
import {
	boolean,
	type Decoder,
	duration,
	formatProblems,
	literal,
	object,
	string,
	stringListOrEmpty,
	trimmedString,
	unit,
	withDefault,
	withDefaultOf,
} from "#util/decode.ts";

const thresholds: Decoder<JudgeThresholds> = object({
	allow: withDefault(unit, DEFAULT_JUDGE.thresholds.allow),
	deny: withDefault(unit, DEFAULT_JUDGE.thresholds.deny),
});

export const judgeConfig: Decoder<JudgeConfig> = object({
	enabled: withDefault(boolean, DEFAULT_JUDGE.enabled),
	provider: withDefault(literal("jev", "pi"), DEFAULT_JUDGE.provider),
	model: withDefault(trimmedString, DEFAULT_JUDGE.model),
	tools: stringListOrEmpty(DEFAULT_JUDGE.tools, "tool name patterns"),
	alwaysAsk: stringListOrEmpty(DEFAULT_JUDGE.alwaysAsk, "tool name patterns"),
	thresholds: withDefaultOf(thresholds, () => ({ ...DEFAULT_JUDGE.thresholds })),
	riskCeiling: withDefault(unit, DEFAULT_JUDGE.riskCeiling),
	whenUnsure: withDefault(literal("ask", "allow", "deny"), DEFAULT_JUDGE.whenUnsure),
	canDeny: withDefault(boolean, DEFAULT_JUDGE.canDeny),
	whenItFails: withDefault(literal("ask", "allow", "deny"), DEFAULT_JUDGE.whenItFails),
	noUI: withDefault(boolean, DEFAULT_JUDGE.noUI),
	dryRun: withDefault(boolean, DEFAULT_JUDGE.dryRun),
	rememberApprovals: withDefault(boolean, DEFAULT_JUDGE.rememberApprovals),
	timeoutMs: withDefault(duration, DEFAULT_JUDGE.timeoutMs),
	cache: withDefault(boolean, DEFAULT_JUDGE.cache),
	policy: withDefault(string, DEFAULT_JUDGE.policy),
});

export function decodeJudge(input: unknown, warnings: string[] = []): JudgeConfig {
	const result = judgeConfig.decode(input, "judge");
	warnings.push(...formatProblems(result.problems));
	return result.ok ? result.value : defaultJudge();
}
