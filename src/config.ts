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

export function agentDir(): string {
	const fromEnv = process.env.PI_CODING_AGENT_DIR;
	if (fromEnv) return expandTilde(fromEnv);
	return join(homedir(), ".pi", "agent");
}

/** Runtime state lives beside the other extensions, never inside the checkout. */
export function configPath(): string {
	return join(agentDir(), "extensions", "pi-ask-permission", "config.json");
}

export function loadConfig(): LoadedConfig {
	const path = configPath();
	const warnings: string[] = [];

	if (!existsSync(path)) {
		try {
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(path, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, "utf8");
		} catch (error) {
			warnings.push(`could not create ${path}: ${describe(error)}`);
		}
		return { config: { ...DEFAULT_CONFIG }, path, warnings };
	}

	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		warnings.push(`could not parse ${path}: ${describe(error)}; using defaults`);
		return { config: { ...DEFAULT_CONFIG }, path, warnings };
	}

	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		warnings.push(`${path} must contain a JSON object; using defaults`);
		return { config: { ...DEFAULT_CONFIG }, path, warnings };
	}

	return { config: coerceConfig(raw as Record<string, unknown>, warnings), path, warnings };
}

/** Rewrites the file from the resolved config. Other keys in the file are dropped. */
export function saveConfig(config: AskConfig): string | undefined {
	const path = configPath();
	try {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
		return undefined;
	} catch (error) {
		return describe(error);
	}
}

export function coerceConfig(raw: Record<string, unknown>, warnings: string[]): AskConfig {
	const config: AskConfig = { ...DEFAULT_CONFIG, allow: [...DEFAULT_CONFIG.allow] };

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

	if (raw.headless === "allow" || raw.headless === "deny") {
		config.headless = raw.headless;
	} else if (raw.headless && typeof raw.headless === "object" && !Array.isArray(raw.headless)) {
		const map: Record<string, HeadlessMode> = {};
		for (const [tool, mode] of Object.entries(raw.headless as Record<string, unknown>)) {
			if (mode === "allow" || mode === "deny") map[tool] = mode;
			else warnings.push(`headless.${tool}: expected "allow" or "deny"`);
		}
		config.headless = map;
	} else if (raw.headless !== undefined) {
		warnings.push('headless: expected "allow", "deny", or a per-tool map');
	}

	if (raw.followup === "result" || raw.followup === "message") {
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
 * wildcard over `*`. Ties are broken by the later entry. This is deliberate —
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

function specificity(pattern: string): number {
	if (pattern === "*") return 1;
	if (pattern.includes("*") || pattern.includes("?")) return 2;
	return 3;
}

const patternCache = new Map<string, RegExp>();

function expandTilde(path: string): string {
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return join(homedir(), path.slice(2));
	return path;
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
