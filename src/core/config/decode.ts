import {
	DEFAULT_CONFIG,
	DEFAULT_TYPING,
	DEFAULT_WORKSPACE,
	defaultConfig,
	type HeadlessMode,
	type PermissionConfig,
	type TypingConfig,
	type WorkspaceConfig,
} from "#core/config/schema.ts";
import { defaultJudge } from "#core/judge/config.ts";
import { judgeConfig } from "#core/judge/decode.ts";
import { DEFAULT_MODE } from "#core/mode.ts";
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

const workspace: Decoder<WorkspaceConfig> = object({
	roots: withDefaultOf(stringList("paths"), () => [...DEFAULT_WORKSPACE.roots]),
	outside: withDefault(literal("ask", "deny", "allow"), DEFAULT_WORKSPACE.outside),
});

const config: Decoder<PermissionConfig> = object({
	allow: withDefaultOf(stringList("tool names"), () => [...DEFAULT_CONFIG.allow]),
	headless: withDefaultOf(headless, () => DEFAULT_CONFIG.headless),
	followup: withDefault(literal("result", "message"), DEFAULT_CONFIG.followup),
	mode: withDefault(literal("manual", "accept-edits", "auto"), DEFAULT_MODE),
	readOnlyBash: withDefault(boolean, DEFAULT_CONFIG.readOnlyBash),
	workspace: withDefaultOf(workspace, () => ({
		...DEFAULT_WORKSPACE,
		roots: [...DEFAULT_WORKSPACE.roots],
	})),
	typing: withDefaultOf(typing, () => ({ ...DEFAULT_TYPING })),
	judge: withDefaultOf(judgeConfig, defaultJudge),
});

export function decodeConfig(input: unknown, warnings: string[] = []): PermissionConfig {
	const result = config.decode(migrate(input, warnings), "");
	warnings.push(...formatProblems(result.problems));

	return result.ok ? result.value : defaultConfig();
}

// `yolo` was a persisted boolean and then a mode. `auto` plus `workspace.outside:
// "allow"` is what the mode meant.
function migrate(input: unknown, warnings: string[]): unknown {
	if (!isObject(input)) return input;
	if (!("mode" in input) && !("yolo" in input)) return input;

	const next = { ...input };
	if (next.mode === "yolo") {
		next.mode = "auto";
		warnings.push(
			'mode "yolo" is gone, using "auto"; set workspace.outside to "allow" for the old reach',
		);
	}
	if ("yolo" in next) {
		delete next.yolo;
		warnings.push("yolo: removed, use mode and pick it per session; delete this key");
	}
	return next;
}
