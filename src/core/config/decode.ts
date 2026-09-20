import {
	DEFAULT_CONFIG,
	DEFAULT_TYPING,
	defaultConfig,
	type HeadlessMode,
	type PermissionConfig,
	type TypingConfig,
} from "#core/config/schema.ts";
import { defaultJudge } from "#core/judge/config.ts";
import { judgeConfig } from "#core/judge/decode.ts";
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
	stringList,
	withDefault,
	withDefaultOf,
} from "#util/decode.ts";

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

const config: Decoder<PermissionConfig> = object({
	allow: withDefaultOf(stringList("tool names"), () => [...DEFAULT_CONFIG.allow]),
	headless: withDefaultOf(headless, () => DEFAULT_CONFIG.headless),
	followup: withDefault(literal("result", "message"), DEFAULT_CONFIG.followup),
	yolo: withDefault(boolean, DEFAULT_CONFIG.yolo),
	readOnlyBash: withDefault(boolean, DEFAULT_CONFIG.readOnlyBash),
	typing: withDefaultOf(typing, () => ({ ...DEFAULT_TYPING })),
	judge: withDefaultOf(judgeConfig, defaultJudge),
});

export function decodeConfig(input: unknown, warnings: string[] = []): PermissionConfig {
	const result = config.decode(input, "");
	warnings.push(...formatProblems(result.problems));
	return result.ok ? result.value : defaultConfig();
}
