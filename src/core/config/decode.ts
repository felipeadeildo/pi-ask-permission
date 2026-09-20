import {
	boolean,
	type Decoder,
	duration,
	fail,
	fieldPath,
	formatProblems,
	isObject,
	literal,
	nullable,
	object,
	pass,
	problem,
	type Problem,
	string,
	stringList,
	stringListOrEmpty,
	trimmedString,
	unit,
	withDefault,
	withDefaultOf,
} from "../../util/decode.ts";
import {
	DEFAULT_CONFIG,
	DEFAULT_JUDGE,
	DEFAULT_TYPING,
	defaultConfig,
	defaultJudge,
	type HeadlessMode,
	type JudgeConfig,
	type JudgeThresholds,
	type PermissionConfig,
	type TypingConfig,
} from "./schema.ts";

type HeadlessConfig = HeadlessMode | Record<string, HeadlessMode>;

const headless: Decoder<HeadlessConfig> = {
	decode(input, path) {
		if (input === "allow" || input === "deny") return pass(input);
		if (!isObject(input)) return fail(problem(path, 'expected "allow", "deny", or a per-tool map'));

		const problems: Problem[] = [];
		const value: Record<string, HeadlessMode> = {};
		for (const [tool, entry] of Object.entries(input)) {
			if (entry === "allow" || entry === "deny") value[tool] = entry;
			else problems.push(problem(fieldPath(path, tool), 'expected "allow" or "deny"'));
		}
		return pass(value, problems);
	},
};

const typing: Decoder<TypingConfig> = object({
	pause: withDefault(duration, DEFAULT_TYPING.pause),
	maxWait: withDefault(nullable(duration), DEFAULT_TYPING.maxWait),
});

const thresholds: Decoder<JudgeThresholds> = object({
	allow: withDefault(unit, DEFAULT_JUDGE.thresholds.allow),
	deny: withDefault(unit, DEFAULT_JUDGE.thresholds.deny),
});

const judge: Decoder<JudgeConfig> = object({
	enabled: withDefault(boolean, DEFAULT_JUDGE.enabled),
	backend: withDefault(literal("jev", "pi"), DEFAULT_JUDGE.backend),
	model: withDefault(trimmedString, DEFAULT_JUDGE.model),
	tools: stringListOrEmpty(DEFAULT_JUDGE.tools, "tool name patterns"),
	never: stringListOrEmpty(DEFAULT_JUDGE.never, "tool name patterns"),
	thresholds: withDefaultOf(thresholds, () => ({ ...DEFAULT_JUDGE.thresholds })),
	intentFloor: withDefault(unit, DEFAULT_JUDGE.intentFloor),
	riskCeiling: withDefault(unit, DEFAULT_JUDGE.riskCeiling),
	onUncertain: withDefault(literal("ask", "allow", "deny"), DEFAULT_JUDGE.onUncertain),
	autoDeny: withDefault(boolean, DEFAULT_JUDGE.autoDeny),
	onError: withDefault(literal("ask", "allow", "deny"), DEFAULT_JUDGE.onError),
	headless: withDefault(boolean, DEFAULT_JUDGE.headless),
	dryRun: withDefault(boolean, DEFAULT_JUDGE.dryRun),
	grant: withDefault(boolean, DEFAULT_JUDGE.grant),
	timeoutMs: withDefault(duration, DEFAULT_JUDGE.timeoutMs),
	cache: withDefault(boolean, DEFAULT_JUDGE.cache),
	includeConversation: withDefault(boolean, DEFAULT_JUDGE.includeConversation),
	policy: withDefault(string, DEFAULT_JUDGE.policy),
});

const config: Decoder<PermissionConfig> = object({
	allow: withDefaultOf(stringList("tool names"), () => [...DEFAULT_CONFIG.allow]),
	headless: withDefaultOf(headless, () => DEFAULT_CONFIG.headless),
	followup: withDefault(literal("result", "message"), DEFAULT_CONFIG.followup),
	yolo: withDefault(boolean, DEFAULT_CONFIG.yolo),
	readOnlyBash: withDefault(boolean, DEFAULT_CONFIG.readOnlyBash),
	typing: withDefaultOf(typing, () => ({ ...DEFAULT_TYPING })),
	judge: withDefaultOf(judge, defaultJudge),
});

export function decodeConfig(input: unknown, warnings: string[] = []): PermissionConfig {
	const result = config.decode(input, "");
	warnings.push(...formatProblems(result.problems));
	return result.ok ? result.value : defaultConfig();
}

export function decodeJudge(input: unknown, warnings: string[] = []): JudgeConfig {
	const result = judge.decode(input, "judge");
	warnings.push(...formatProblems(result.problems));
	return result.ok ? result.value : defaultJudge();
}
