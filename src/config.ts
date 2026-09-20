/**
 * pi-ask-permission configuration.
 *
 * One JSON file, four keys. Missing keys fall back to the defaults below; a
 * malformed file is reported and the defaults are used rather than silently
 * weakening the gate.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { describe, isRecord } from "./util.ts";

/** What to do when there is nobody to ask. */
export type HeadlessMode = "allow" | "deny";

/** Where a note attached to an approval reaches the model. */
export type FollowupWire = "result" | "message";

export interface AskConfig {
	/** Tool names that never prompt. `*` and `?` wildcards are supported. */
	allow: string[];
	/** Behavior when no UI is available, either globally or per tool. */
	headless: HeadlessMode | Record<string, HeadlessMode>;
	/** Delivery channel for a note attached to an approval. */
	followup: FollowupWire;
	/** Skip the dialog entirely and approve everything. */
	yolo: boolean;
}

export const DEFAULT_CONFIG: AskConfig = {
	allow: ["read", "grep", "find", "ls"],
	headless: "deny",
	followup: "result",
	yolo: false,
};

export interface LoadedConfig {
	config: AskConfig;
	path: string;
	/** Human-readable problems found while loading. */
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

	return config;
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

/**
 * Specificity beats file order: an exact tool name wins over a wildcard, and a
 * wildcard over `*`. Ties are broken by the later entry. This is deliberate:
 * a `headless` map exists to carve out exceptions, and expecting the author to
 * remember rule order for that would be a trap.
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

/** An exact name scores highest, then a wildcard, then `*`. */
function specificity(pattern: string): number {
	if (pattern === "*") return 1;
	if (pattern.includes("*") || pattern.includes("?")) return 2;
	return 3;
}

/** A fresh copy, so a caller can replace `allow` without touching the exported default. */
function defaults(): AskConfig {
	return { ...DEFAULT_CONFIG, allow: [...DEFAULT_CONFIG.allow] };
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
