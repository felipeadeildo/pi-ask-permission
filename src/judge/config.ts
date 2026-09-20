/**
 * The judge's own slice of the config. Every field is a guardrail, so an
 * unusable value falls back to the conservative default and says so: a typo
 * must never widen what the judge may approve.
 */
import { isDuration, isRecord, isUnit, warn } from "../util.ts";

export type JudgeBackendId = "jev" | "pi";

export type JudgeFallback = "ask" | "allow" | "deny";

export interface JudgeThresholds {
	/** Minimum verdict confidence before the judge may approve on its own. */
	allow: number;
	/** Minimum verdict confidence before the judge may deny on its own. */
	deny: number;
}

export interface JudgeConfig {
	enabled: boolean;
	backend: JudgeBackendId;
	/** `jev` model id or alias, or `provider/modelId` for the `pi` backend. */
	model: string;
	/** Tool name patterns the judge may decide. Empty means it never runs. */
	tools: string[];
	/** Patterns the judge may never auto-approve, whatever it answers. */
	never: string[];
	thresholds: JudgeThresholds;
	/** How well the call must serve the user's request to be approved alone. */
	intentFloor: number;
	/** Composed risk above which the judge always defers to the user. */
	riskCeiling: number;
	/** What to do when the judge is not confident enough. */
	onUncertain: JudgeFallback;
	/** Let a confident judge deny a call on its own. */
	autoDeny: boolean;
	/** What to do when the judge could not answer at all. */
	onError: JudgeFallback;
	/** Let the judge decide when there is no UI to ask (print, JSON, subagent). */
	headless: boolean;
	/** Show the verdict but still ask the user, to build trust before enabling. */
	dryRun: boolean;
	/** Remember judge approvals for the rest of the session. */
	grant: boolean;
	timeoutMs: number;
	/** Reuse a decision for an identical call within the session. */
	cache: boolean;
	/** Attach the last user message so the judge can weigh intent. */
	includeConversation: boolean;
	/** Operator policy: what may run, what must always ask, when in doubt. */
	policy: string;
}

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

export function isJudgeBackendId(value: unknown): value is JudgeBackendId {
	return value === "jev" || value === "pi";
}

export function isJudgeFallback(value: unknown): value is JudgeFallback {
	return value === "ask" || value === "allow" || value === "deny";
}

/** A fresh, mutable copy so edits never touch `DEFAULT_JUDGE`. */
export function defaultJudge(): JudgeConfig {
	return {
		...DEFAULT_JUDGE,
		thresholds: { ...DEFAULT_JUDGE.thresholds },
		tools: [...DEFAULT_JUDGE.tools],
		never: [...DEFAULT_JUDGE.never],
	};
}

export function coerceJudge(raw: Record<string, unknown>, warnings: string[]): JudgeConfig {
	const judge = defaultJudge();

	if (typeof raw.enabled === "boolean") judge.enabled = raw.enabled;
	else if (raw.enabled !== undefined) warn(warnings, "judge.enabled", "expected a boolean");

	if (isJudgeBackendId(raw.backend)) judge.backend = raw.backend;
	else if (raw.backend !== undefined) warn(warnings, "judge.backend", 'expected "jev" or "pi"');

	if (typeof raw.model === "string" && raw.model.trim() !== "") judge.model = raw.model.trim();
	else if (raw.model !== undefined) warn(warnings, "judge.model", "expected a non-empty string");

	judge.tools = coercePatternList(raw.tools, "judge.tools", judge.tools, warnings);
	judge.never = coercePatternList(raw.never, "judge.never", judge.never, warnings);

	if (isRecord(raw.thresholds)) {
		if (isUnit(raw.thresholds.allow)) judge.thresholds.allow = raw.thresholds.allow;
		else if (raw.thresholds.allow !== undefined)
			warn(warnings, "judge.thresholds.allow", "expected a number from 0 to 1");

		if (isUnit(raw.thresholds.deny)) judge.thresholds.deny = raw.thresholds.deny;
		else if (raw.thresholds.deny !== undefined)
			warn(warnings, "judge.thresholds.deny", "expected a number from 0 to 1");
	} else if (raw.thresholds !== undefined) {
		warn(warnings, "judge.thresholds", "expected an object with allow and deny");
	}

	if (isUnit(raw.intentFloor)) judge.intentFloor = raw.intentFloor;
	else if (raw.intentFloor !== undefined)
		warn(warnings, "judge.intentFloor", "expected a number from 0 to 1");

	if (isUnit(raw.riskCeiling)) judge.riskCeiling = raw.riskCeiling;
	else if (raw.riskCeiling !== undefined)
		warn(warnings, "judge.riskCeiling", "expected a number from 0 to 1");

	if (isJudgeFallback(raw.onUncertain)) judge.onUncertain = raw.onUncertain;
	else if (raw.onUncertain !== undefined)
		warn(warnings, "judge.onUncertain", 'expected "ask", "allow", or "deny"');

	if (isJudgeFallback(raw.onError)) judge.onError = raw.onError;
	else if (raw.onError !== undefined)
		warn(warnings, "judge.onError", 'expected "ask", "allow", or "deny"');

	coerceBooleans(raw, judge, warnings);

	if (isDuration(raw.timeoutMs)) judge.timeoutMs = raw.timeoutMs;
	else if (raw.timeoutMs !== undefined)
		warn(warnings, "judge.timeoutMs", "expected a non-negative number of milliseconds");

	if (typeof raw.policy === "string") judge.policy = raw.policy;
	else if (raw.policy !== undefined) warn(warnings, "judge.policy", "expected a string");

	return judge;
}

const BOOLEAN_KEYS = [
	"headless",
	"dryRun",
	"grant",
	"cache",
	"autoDeny",
	"includeConversation",
] as const;

function coerceBooleans(
	raw: Record<string, unknown>,
	judge: JudgeConfig,
	warnings: string[],
): void {
	for (const key of BOOLEAN_KEYS) {
		const value = raw[key];
		if (typeof value === "boolean") judge[key] = value;
		else if (value !== undefined) warn(warnings, `judge.${key}`, "expected a boolean");
	}
}

/**
 * A missing list keeps the default; a present but unusable one falls back to an
 * empty list, which is the narrow reading in both call sites.
 */
function coercePatternList(
	value: unknown,
	path: string,
	fallback: string[],
	warnings: string[],
): string[] {
	if (value === undefined) return fallback;
	if (!Array.isArray(value)) {
		warn(warnings, path, "expected an array of tool name patterns");
		return [];
	}

	const patterns = value.filter(
		(entry): entry is string => typeof entry === "string" && entry !== "",
	);
	if (patterns.length !== value.length)
		warn(warnings, path, "ignored entries that are not non-empty strings");
	return patterns;
}
