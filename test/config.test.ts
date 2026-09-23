import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { decodeConfig } from "#core/config/decode.ts";
import { headlessMode, isAllowed, isJudged, matchesPattern } from "#core/config/patterns.ts";
import { DEFAULT_CONFIG, type PermissionConfig } from "#core/config/schema.ts";
import { configPath, loadConfig, saveConfig } from "#core/config/store.ts";
import { DEFAULT_JUDGE } from "#core/judge/config.ts";
import { decodeJudge } from "#core/judge/decode.ts";

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

describe("decodeConfig", () => {
	test("an empty object yields the defaults", () => {
		expect(decodeConfig({}, [])).toEqual(DEFAULT_CONFIG);
	});

	test("drops non-string allow entries and warns", () => {
		const warnings: string[] = [];
		expect(decodeConfig({ allow: ["bash", 3, ""] }, warnings).allow).toEqual(["bash"]);
		expect(warnings).toHaveLength(1);
	});

	test("keeps a valid headless map and drops invalid modes", () => {
		const warnings: string[] = [];
		expect(decodeConfig({ headless: { bash: "deny", bad: "nope" } }, warnings).headless).toEqual({
			bash: "deny",
		});
		expect(warnings).toEqual(['headless.bad: expected "allow" or "deny"']);
	});

	test("rejects a bad followup wire", () => {
		const warnings: string[] = [];
		expect(decodeConfig({ followup: "carrier-pigeon" }, warnings).followup).toBe("result");
		expect(warnings).toHaveLength(1);
	});

	test("rejects a bad mode", () => {
		const warnings: string[] = [];
		expect(decodeConfig({ mode: "sometimes" }, warnings).mode).toBe(DEFAULT_CONFIG.mode);
		expect(warnings).toHaveLength(1);
	});

	test("reads a valid mode", () => {
		const warnings: string[] = [];
		expect(decodeConfig({ mode: "accept-edits" }, warnings).mode).toBe("accept-edits");
		expect(warnings).toEqual([]);
	});

	test("drops the removed yolo key and warns", () => {
		const warnings: string[] = [];
		expect(decodeConfig({ yolo: true }, warnings).mode).toBe("manual");
		expect(warnings).toContain("yolo: removed, use mode and pick it per session; delete this key");
	});

	test("moves a persisted yolo mode to auto and warns", () => {
		const warnings: string[] = [];
		expect(decodeConfig({ mode: "yolo" }, warnings).mode).toBe("auto");
		expect(warnings).toContain(
			'mode "yolo" is gone, using "auto"; set workspace.outside to "allow" for the old reach',
		);
	});

	test("reads a workspace block", () => {
		const warnings: string[] = [];
		expect(decodeConfig({ workspace: { roots: [".", "~/Projects"] } }, warnings).workspace).toEqual(
			{ roots: [".", "~/Projects"], outside: "ask" },
		);
		expect(warnings).toEqual([]);
	});

	test("falls back on a bad workspace block", () => {
		const warnings: string[] = [];
		expect(
			decodeConfig({ workspace: { roots: "~", outside: "maybe" } }, warnings).workspace,
		).toEqual(DEFAULT_CONFIG.workspace);
		expect(warnings).toHaveLength(2);
	});

	test("rejects an array where an object is expected", () => {
		const warnings: string[] = [];
		expect(decodeConfig({ allow: "bash" }, warnings).allow).toEqual(DEFAULT_CONFIG.allow);
		expect(warnings).toHaveLength(1);
	});

	test("reads a typing block", () => {
		const warnings: string[] = [];
		expect(decodeConfig({ typing: { pause: 250, maxWait: 5000 } }, warnings).typing).toEqual({
			pause: 250,
			maxWait: 5000,
		});
		expect(warnings).toEqual([]);
	});

	test("a missing typing.maxWait means no cap", () => {
		expect(decodeConfig({}, []).typing.maxWait).toBeNull();
		expect(decodeConfig({ typing: { maxWait: null } }, []).typing.maxWait).toBeNull();
	});

	test("drops invalid typing values and warns", () => {
		const warnings: string[] = [];
		expect(decodeConfig({ typing: { pause: -1, maxWait: "soon" } }, warnings).typing).toEqual(
			DEFAULT_CONFIG.typing,
		);
		expect(warnings).toHaveLength(2);
	});

	test("rejects a non-object typing value", () => {
		const warnings: string[] = [];
		expect(decodeConfig({ typing: 5 }, warnings).typing).toEqual(DEFAULT_CONFIG.typing);
		expect(warnings).toHaveLength(1);
	});

	test("an invalid higher-precedence value never widens access", () => {
		const warnings: string[] = [];
		const config = decodeConfig({ headless: 42, allow: null, mode: "sometimes" }, warnings);
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

describe("isJudged", () => {
	test("is false until the judge is enabled and the tool matches", () => {
		const off = { ...DEFAULT_CONFIG, judge: { ...DEFAULT_JUDGE, tools: ["bash"] } };
		expect(isJudged(off, "bash")).toBe(false);

		const on = { ...off, judge: { ...off.judge, enabled: true } };
		expect(isJudged(on, "bash")).toBe(true);
		expect(isJudged(on, "write")).toBe(false);
	});
});

describe("decodeJudge", () => {
	test("an empty block yields the defaults", () => {
		expect(decodeJudge({}, [])).toEqual(DEFAULT_JUDGE);
	});

	test("reads a full block without warnings", () => {
		const warnings: string[] = [];
		const judge = decodeJudge(
			{
				enabled: true,
				backend: "pi",
				model: "anthropic/claude",
				tools: ["bash", "write"],
				never: ["rm -rf*"],
				thresholds: { allow: 0.9, deny: 0.7 },
				riskCeiling: 0.3,
				onUncertain: "deny",
				autoDeny: false,
				onError: "deny",
				headless: true,
				dryRun: true,
				grant: true,
				cache: false,
				timeoutMs: 500,
				policy: "be careful",
			},
			warnings,
		);

		expect(warnings).toEqual([]);
		expect(judge).toEqual({
			enabled: true,
			backend: "pi",
			model: "anthropic/claude",
			tools: ["bash", "write"],
			never: ["rm -rf*"],
			thresholds: { allow: 0.9, deny: 0.7 },
			riskCeiling: 0.3,
			onUncertain: "deny",
			autoDeny: false,
			onError: "deny",
			headless: true,
			dryRun: true,
			grant: true,
			cache: false,
			timeoutMs: 500,
			policy: "be careful",
		});
	});

	test("drops invalid values and warns, never widening", () => {
		const warnings: string[] = [];
		const judge = decodeJudge(
			{
				enabled: "yes",
				backend: "nope",
				thresholds: { allow: 2 },
				tools: "bash",
				never: ["ok", 3, ""],
			},
			warnings,
		);

		expect(judge.enabled).toBe(false);
		expect(judge.backend).toBe("jev");
		expect(judge.thresholds.allow).toBe(DEFAULT_JUDGE.thresholds.allow);
		expect(judge.tools).toEqual([]);
		expect(judge.never).toEqual(["ok"]);
		expect(warnings).toContain("judge.enabled: expected a boolean");
		expect(warnings).toContain('judge.backend: expected "jev" or "pi"');
		expect(warnings).toContain("judge.thresholds.allow: expected a number from 0 to 1");
		expect(warnings).toContain("judge.tools: expected an array of tool name patterns");
		expect(warnings).toContain("judge.never: ignored entries that are not non-empty strings");
	});

	test("decodeConfig carries the judge block", () => {
		const config = decodeConfig({ judge: { enabled: true } }, []);
		expect(config.judge.enabled).toBe(true);
		expect(config.judge.model).toBe("jev-latest");
	});

	test("a non-object judge block falls back to the defaults", () => {
		const warnings: string[] = [];
		const config = decodeConfig({ judge: 5 }, warnings);
		expect(config.judge).toEqual(DEFAULT_JUDGE);
		expect(warnings).toContain("judge: expected an object");
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
		const config: PermissionConfig = {
			...DEFAULT_CONFIG,
			headless: { "*": "allow", bash: "deny" },
		};
		expect(headlessMode(config, "bash")).toBe("deny");
		expect(headlessMode(config, "write")).toBe("allow");
	});

	test("a wildcard beats * regardless of file order", () => {
		const config: PermissionConfig = {
			...DEFAULT_CONFIG,
			headless: { "mcp_*": "allow", "*": "deny" },
		};
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

	test("a loaded config does not alias the exported defaults", () => {
		const loaded = loadConfig();
		loaded.config.allow.push("bash");
		loaded.config.typing.pause = 1;
		expect(DEFAULT_CONFIG.allow).not.toContain("bash");
		expect(DEFAULT_CONFIG.typing.pause).toBe(1000);
	});
});
