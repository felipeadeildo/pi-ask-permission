import {
	DEFAULT_CONFIG,
	DEFAULT_TYPING,
	DEFAULT_WORKSPACE,
	defaultConfig,
	type NoUIMode,
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

type NoUIConfig = NoUIMode | Record<string, NoUIMode>;

const noUI: Decoder<NoUIConfig> = {
	decode(input, path) {
		if (input === "allow" || input === "deny") return pass(input);
		if (!isObject(input)) return fail(problem(path, 'expected "allow", "deny", or a per-tool map'));

		const problems: Problem[] = [];
		const value: Record<string, NoUIMode> = {};
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
	noUI: withDefaultOf(noUI, () => DEFAULT_CONFIG.noUI),
	notes: withDefault(literal("result", "message"), DEFAULT_CONFIG.notes),
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

const RENAMED: [section: "judge" | undefined, from: string, to: string][] = [
	[undefined, "followup", "notes"],
	[undefined, "headless", "noUI"],
	["judge", "backend", "provider"],
	["judge", "autoDeny", "canDeny"],
	["judge", "onUncertain", "whenUnsure"],
	["judge", "onError", "whenItFails"],
	["judge", "never", "alwaysAsk"],
	["judge", "headless", "noUI"],
	["judge", "grant", "rememberApprovals"],
];

/** Whether the file still uses a key from before 3.0, so loading it rewrites it. */
export function isOutdated(input: unknown): boolean {
	if (!isObject(input)) return false;
	const judge = isObject(input.judge) ? input.judge : {};
	return (
		"yolo" in input ||
		RENAMED.some(([section, from]) => from in (section === undefined ? input : judge))
	);
}

// A rename keeps the value and says nothing: the file is rewritten with the new name.
function migrate(input: unknown, warnings: string[]): unknown {
	if (!isObject(input)) return input;

	const next: Record<string, unknown> = { ...input };
	if (isObject(next.judge)) next.judge = { ...next.judge };

	for (const [section, from, to] of RENAMED) {
		const target = section === undefined ? next : next[section];
		if (!isObject(target) || !(from in target)) continue;

		if (!(to in target)) target[to] = target[from];
		delete target[from];
	}

	if (next.mode === "yolo") {
		next.mode = "auto";
		warnings.push('mode "yolo" is now "auto", with workspace.outside "allow" for the same reach');
	}
	if ("yolo" in next) {
		delete next.yolo;
		warnings.push("yolo is gone, the mode is picked per session");
	}
	return next;
}
