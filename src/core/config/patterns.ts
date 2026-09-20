import type { HeadlessMode, PermissionConfig } from "#core/config/schema.ts";

const patternCache = new Map<string, RegExp>();

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

export function isAllowed(config: PermissionConfig, toolName: string): boolean {
	return config.allow.some((pattern) => matchesPattern(pattern, toolName));
}

export function isJudged(config: PermissionConfig, toolName: string): boolean {
	return (
		config.judge.enabled && config.judge.tools.some((pattern) => matchesPattern(pattern, toolName))
	);
}

export function headlessMode(config: PermissionConfig, toolName: string): HeadlessMode {
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
