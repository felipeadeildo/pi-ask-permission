/**
 * One JSON config file. Missing keys fall back to the defaults; a malformed file
 * is reported and defaults are used rather than silently weakening the gate.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { coerceJudge, DEFAULT_JUDGE, defaultJudge, type JudgeConfig } from "./judge/config.ts";
import { describe, isDuration, isRecord } from "./util.ts";

export type HeadlessMode = "allow" | "deny";

export type FollowupWire = "result" | "message";

export interface TypingConfig {
	/** Milliseconds of silence before a dialog may open. */
	pause: number;
	/** Milliseconds before the wait gives up, or null to wait as long as typing lasts. */
	maxWait: number | null;
}

export interface AskConfig {
	/** Tool names that never prompt. `*` and `?` wildcards are supported. */
	allow: string[];
	/** Behavior when no UI is available, globally or per tool. */
	headless: HeadlessMode | Record<string, HeadlessMode>;
	followup: FollowupWire;
	/** Skip the dialog entirely and approve everything. */
	yolo: boolean;
	/** Approve bash commands that only read. */
	readOnlyBash: boolean;
	/** How a dialog waits for the user to stop typing. */
	typing: TypingConfig;
	/** Delegating approval to a judge model. */
	judge: JudgeConfig;
}

export const DEFAULT_CONFIG: AskConfig = {
	allow: ["read", "grep", "find", "ls"],
	headless: "deny",
	followup: "result",
	yolo: false,
	readOnlyBash: true,
	typing: { pause: 1000, maxWait: null },
	judge: DEFAULT_JUDGE,
};

export interface LoadedConfig {
	config: AskConfig;
	path: string;
	warnings: string[];
}

export function isHeadlessMode(value: unknown): value is HeadlessMode {
	return value === "allow" || value === "deny";
}

export function isFollowupWire(value: unknown): value is FollowupWire {
	return value === "result" || value === "message";
}

export function agentDir(): string {
	const fromEnv = process.env.PI_CODING_AGENT_DIR;
	if (fromEnv) return expandTilde(fromEnv);
	return join(homedir(), ".pi", "agent");
}

/** Runtime state lives beside the other extensions, never inside the checkout. */
export function configPath(): string {
	return join(agentDir(), "extensions", "pi-ask-permission", "config.json");
}

export function grantsPath(): string {
	return join(agentDir(), "extensions", "pi-ask-permission", "grants.json");
}

/** Project state follows `CONFIG_DIR_NAME`, which a rebranded pi may rename. */
export function projectGrantsPath(cwd: string, configDirName: string): string {
	return join(cwd, configDirName, "extensions", "pi-ask-permission", "grants.json");
}

export function loadConfig(): LoadedConfig {
	const path = configPath();
	const warnings: string[] = [];
	let config = defaults();

	if (!existsSync(path)) {
		try {
			writeConfigFile(path, config);
		} catch (error) {
			warnings.push(`could not create ${path}: ${describe(error)}`);
		}
		return { config, path, warnings };
	}

	try {
		const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (isRecord(raw)) config = coerceConfig(raw, warnings);
		else warnings.push(`${path} must contain a JSON object; using defaults`);
	} catch (error) {
		warnings.push(`could not parse ${path}: ${describe(error)}; using defaults`);
	}

	return { config, path, warnings };
}

/** Rewrites the file from the resolved config. Returns an error message on failure. */
export function saveConfig(config: AskConfig): string | undefined {
	try {
		writeConfigFile(configPath(), config);
		return undefined;
	} catch (error) {
		return describe(error);
	}
}

export function coerceConfig(raw: Record<string, unknown>, warnings: string[]): AskConfig {
	const config = defaults();

	if (Array.isArray(raw.allow)) {
		const allow = raw.allow.filter(
			(value): value is string => typeof value === "string" && value !== "",
		);
		if (allow.length !== raw.allow.length)
			warnings.push("allow: ignored entries that are not non-empty strings");
		config.allow = allow;
	} else if (raw.allow !== undefined) {
		warnings.push("allow: expected an array of tool names");
	}

	if (isHeadlessMode(raw.headless)) {
		config.headless = raw.headless;
	} else if (isRecord(raw.headless)) {
		const map: Record<string, HeadlessMode> = {};
		for (const [tool, mode] of Object.entries(raw.headless)) {
			if (isHeadlessMode(mode)) map[tool] = mode;
			else warnings.push(`headless.${tool}: expected "allow" or "deny"`);
		}
		config.headless = map;
	} else if (raw.headless !== undefined) {
		warnings.push('headless: expected "allow", "deny", or a per-tool map');
	}

	if (isFollowupWire(raw.followup)) {
		config.followup = raw.followup;
	} else if (raw.followup !== undefined) {
		warnings.push('followup: expected "result" or "message"');
	}

	if (typeof raw.yolo === "boolean") config.yolo = raw.yolo;
	else if (raw.yolo !== undefined) warnings.push("yolo: expected a boolean");

	if (typeof raw.readOnlyBash === "boolean") config.readOnlyBash = raw.readOnlyBash;
	else if (raw.readOnlyBash !== undefined) warnings.push("readOnlyBash: expected a boolean");

	if (isRecord(raw.typing)) {
		config.typing = coerceTyping(raw.typing, warnings);
	} else if (raw.typing !== undefined) {
		warnings.push("typing: expected an object with pause and maxWait");
	}

	if (isRecord(raw.judge)) {
		config.judge = coerceJudge(raw.judge, warnings);
	} else if (raw.judge !== undefined) {
		warnings.push("judge: expected an object");
	}

	return config;
}

function coerceTyping(raw: Record<string, unknown>, warnings: string[]): TypingConfig {
	const typing = { ...DEFAULT_CONFIG.typing };

	if (isDuration(raw.pause)) typing.pause = raw.pause;
	else if (raw.pause !== undefined)
		warnings.push("typing.pause: expected a non-negative number of milliseconds");

	if (raw.maxWait === null) typing.maxWait = null;
	else if (isDuration(raw.maxWait)) typing.maxWait = raw.maxWait;
	else if (raw.maxWait !== undefined)
		warnings.push("typing.maxWait: expected milliseconds or null");

	return typing;
}

/** `*` matches any run of characters, `?` exactly one. */
export function matchesPattern(pattern: string, value: string): boolean {
	if (pattern === "*") return true;

	let compiled = patternCache.get(pattern);
	if (!compiled) {
		const escaped = pattern
			.replace(/[.+^${}()|[\]\\]/g, "\\$&")
			.replace(/\*/g, ".*")
			.replace(/\?/g, ".");
		compiled = new RegExp(`^${escaped}$`);
		patternCache.set(pattern, compiled);
	}
	return compiled.test(value);
}

export function isAllowed(config: AskConfig, toolName: string): boolean {
	return config.allow.some((pattern) => matchesPattern(pattern, toolName));
}

/** True when the judge may decide this tool at all. */
export function isJudged(config: AskConfig, toolName: string): boolean {
	return (
		config.judge.enabled && config.judge.tools.some((pattern) => matchesPattern(pattern, toolName))
	);
}

/**
 * Specificity beats file order: an exact name wins over a wildcard, a wildcard
 * over `*`, and ties go to the later entry.
 */
export function headlessMode(config: AskConfig, toolName: string): HeadlessMode {
	if (typeof config.headless === "string") return config.headless;

	let bestScore = 0;
	let best: HeadlessMode | undefined;
	for (const [pattern, value] of Object.entries(config.headless)) {
		if (!matchesPattern(pattern, toolName)) continue;

		const score = specificity(pattern);
		if (score >= bestScore) {
			bestScore = score;
			best = value;
		}
	}
	return best ?? "deny";
}

function specificity(pattern: string): number {
	if (pattern === "*") return 1;
	if (pattern.includes("*") || pattern.includes("?")) return 2;
	return 3;
}

/** A copy, so mutating `allow` or `typing` never touches DEFAULT_CONFIG. */
function defaults(): AskConfig {
	return {
		...DEFAULT_CONFIG,
		allow: [...DEFAULT_CONFIG.allow],
		typing: { ...DEFAULT_CONFIG.typing },
		judge: defaultJudge(),
	};
}

function writeConfigFile(path: string, config: AskConfig): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

const patternCache = new Map<string, RegExp>();

function expandTilde(path: string): string {
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return join(homedir(), path.slice(2));
	return path;
}
