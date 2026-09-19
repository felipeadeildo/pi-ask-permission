import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	type AskConfig,
	agentDir,
	coerceConfig,
	configPath,
	DEFAULT_CONFIG,
	headlessMode,
	isAllowed,
	loadConfig,
	matchesPattern,
	saveConfig,
} from "../src/config.ts";

describe("matchesPattern", () => {
	test.each([
		["git", "git", true],
		["git*", "git", true],
		["git*", "github", true],
		["mcp_*", "mcp_github", true],
		["mcp_*", "bash", false],
		["?at", "cat", true],
		["?at", "chat", false],
		["*", "anything", true],
		["read", "write", false],
	])("%s vs %s", (pattern, value, expected) => {
		expect(matchesPattern(pattern as string, value as string)).toBe(expected);
	});

	test("regex metacharacters are literal", () => {
		expect(matchesPattern("a.b", "axb")).toBe(false);
		expect(matchesPattern("a.b", "a.b")).toBe(true);
	});
});

describe("coerceConfig", () => {
	test("an empty object yields the defaults", () => {
		expect(coerceConfig({}, [])).toEqual(DEFAULT_CONFIG);
	});

	test("drops non-string allow entries and warns", () => {
		const warnings: string[] = [];
		expect(coerceConfig({ allow: ["bash", 3, ""] }, warnings).allow).toEqual(["bash"]);
		expect(warnings).toHaveLength(1);
	});

	test("keeps a valid headless map and drops invalid modes", () => {
		const warnings: string[] = [];
		expect(coerceConfig({ headless: { bash: "deny", bad: "nope" } }, warnings).headless).toEqual({
			bash: "deny",
		});
		expect(warnings).toEqual(['headless.bad: expected "allow" or "deny"']);
	});

	test("rejects a bad followup wire", () => {
		const warnings: string[] = [];
		expect(coerceConfig({ followup: "carrier-pigeon" }, warnings).followup).toBe("result");
		expect(warnings).toHaveLength(1);
	});

	test("rejects an array where an object is expected", () => {
		const warnings: string[] = [];
		expect(coerceConfig({ allow: "bash" }, warnings).allow).toEqual(DEFAULT_CONFIG.allow);
		expect(warnings).toHaveLength(1);
	});

	test("an invalid higher-precedence value never widens access", () => {
		const warnings: string[] = [];
		const config = coerceConfig({ headless: 42, allow: null, yolo: "yes" }, warnings);
		expect(config).toEqual(DEFAULT_CONFIG);
		expect(warnings).toHaveLength(3);
	});
});

describe("isAllowed", () => {
	test("matches any pattern in the list", () => {
		const config = { ...DEFAULT_CONFIG, allow: ["read", "mcp_*"] };
		expect(isAllowed(config, "read")).toBe(true);
		expect(isAllowed(config, "mcp_github")).toBe(true);
		expect(isAllowed(config, "bash")).toBe(false);
	});
});

describe("headlessMode", () => {
	test("a string applies to every tool", () => {
		expect(headlessMode({ ...DEFAULT_CONFIG, headless: "allow" }, "bash")).toBe("allow");
	});

	test("defaults to deny when nothing matches", () => {
		expect(headlessMode({ ...DEFAULT_CONFIG, headless: { bash: "allow" } }, "write")).toBe("deny");
	});

	test("an exact tool beats a wildcard regardless of file order", () => {
		const config: AskConfig = { ...DEFAULT_CONFIG, headless: { "*": "allow", bash: "deny" } };
		expect(headlessMode(config, "bash")).toBe("deny");
		expect(headlessMode(config, "write")).toBe("allow");
	});

	test("a wildcard beats * regardless of file order", () => {
		const config: AskConfig = { ...DEFAULT_CONFIG, headless: { "mcp_*": "allow", "*": "deny" } };
		expect(headlessMode(config, "mcp_github")).toBe("allow");
		expect(headlessMode(config, "bash")).toBe("deny");
	});
});

describe("config file", () => {
	let dir: string;
	let previous: string | undefined;

	beforeEach(() => {
		previous = process.env.PI_CODING_AGENT_DIR;
		dir = mkdtempSync(join(tmpdir(), "pi-ask-"));
		process.env.PI_CODING_AGENT_DIR = dir;
	});

	afterEach(() => {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		rmSync(dir, { recursive: true, force: true });
	});

	test("agentDir honors PI_CODING_AGENT_DIR", () => {
		expect(agentDir()).toBe(dir);
	});

	test("config lives outside the checkout, under the agent dir", () => {
		expect(configPath()).toBe(join(dir, "extensions", "pi-ask-permission", "config.json"));
	});

	test("a missing file is created from the defaults", () => {
		const loaded = loadConfig();
		expect(loaded.config).toEqual(DEFAULT_CONFIG);
		expect(loaded.warnings).toEqual([]);
		expect(JSON.parse(readFileSync(configPath(), "utf8"))).toEqual(DEFAULT_CONFIG);
	});

	test("a malformed file falls back to the defaults and warns", () => {
		const path = configPath();
		saveConfig(DEFAULT_CONFIG);
		writeFileSync(path, "{ not json");

		const loaded = loadConfig();
		expect(loaded.config).toEqual(DEFAULT_CONFIG);
		expect(loaded.warnings[0]).toContain("could not parse");
	});

	test("a non-object file falls back to the defaults and warns", () => {
		saveConfig(DEFAULT_CONFIG);
		writeFileSync(configPath(), "[1, 2, 3]");

		const loaded = loadConfig();
		expect(loaded.config).toEqual(DEFAULT_CONFIG);
		expect(loaded.warnings[0]).toContain("must contain a JSON object");
	});

	test("saveConfig round-trips", () => {
		const config = { ...DEFAULT_CONFIG, followup: "message" as const, allow: ["bash"] };
		expect(saveConfig(config)).toBeUndefined();
		expect(loadConfig().config).toEqual(config);
	});
});
