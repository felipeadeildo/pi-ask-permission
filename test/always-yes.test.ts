import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AlwaysYes, readLevels, SCOPE_LABEL, SCOPES } from "#core/always-yes.ts";

let dir: string;
let global: string;
let project: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "pi-ask-always-yes-"));
	global = join(dir, "global", "always-yes.json");
	project = join(dir, "project", "always-yes.json");
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

function opened(files: { global: string; project?: string } = { global, project }): AlwaysYes {
	const alwaysYes = new AlwaysYes();
	alwaysYes.open(files);
	return alwaysYes;
}

function write(path: string, content: string): void {
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, content);
}

function onDisk(path: string): unknown {
	return JSON.parse(readFileSync(path, "utf8"));
}

describe("scopes", () => {
	test("run narrowest to widest", () => {
		expect(SCOPES).toEqual(["session", "project", "global"]);
	});

	test("every scope has a label", () => {
		for (const scope of SCOPES) expect(SCOPE_LABEL[scope]).toBeTruthy();
	});
});

describe("readLevels", () => {
	test("a missing file is empty, with no warning", () => {
		expect(readLevels(global)).toEqual({ levels: new Set() });
	});

	test("a malformed file warns", () => {
		write(global, "{ nope");
		expect(readLevels(global).warning).toContain("could not parse");
	});

	test("a file that is not an object warns", () => {
		write(global, "[1, 2]");
		expect(readLevels(global).warning).toContain("must contain a JSON object");
	});

	test("skips levels that are not strings", () => {
		write(global, JSON.stringify({ bash: ["git", 7, "", null], write: "not a list" }));
		expect(readLevels(global).levels.size).toBe(1);
	});
});

describe("always yes", () => {
	test("matches by tool and level", () => {
		write(global, JSON.stringify({ bash: ["git status"] }));
		const alwaysYes = opened();

		expect(alwaysYes.has("bash", ["git", "git status"])).toBe(true);
		expect(alwaysYes.has("bash", ["git"])).toBe(false);
		expect(alwaysYes.has("write", ["git status"])).toBe(false);
	});

	test("a crafted tool name cannot match another tool's level", () => {
		const alwaysYes = opened();
		alwaysYes.add("session", "bash\u0000git", "");
		expect(alwaysYes.has("bash", ["git"])).toBe(false);
	});

	test("opening a session starts this session empty", () => {
		const alwaysYes = opened();
		alwaysYes.add("session", "bash", "git");
		alwaysYes.open({ global, project });
		expect(alwaysYes.has("bash", ["git"])).toBe(false);
	});

	test("this session is never written to disk", () => {
		opened().add("session", "bash", "git");
		expect(existsSync(global)).toBe(false);
		expect(existsSync(project)).toBe(false);
	});

	test("saves a stable, readable shape", () => {
		const alwaysYes = opened();
		alwaysYes.add("global", "write", "b");
		alwaysYes.add("global", "bash", "z");
		alwaysYes.add("global", "bash", "a");

		expect(onDisk(global)).toEqual({ bash: ["a", "z"], write: ["b"] });
	});

	test("keeps what another pi saved after this one loaded", () => {
		const alwaysYes = opened();
		opened().add("project", "bash", "pnpm test");
		alwaysYes.add("project", "bash", "pnpm lint");

		expect(onDisk(project)).toEqual({ bash: ["pnpm lint", "pnpm test"] });
		expect(alwaysYes.has("bash", ["pnpm test"])).toBe(true);
	});

	test("does not overwrite a file it cannot read", () => {
		write(global, "{ hand edited");
		const alwaysYes = opened();

		expect(alwaysYes.add("global", "bash", "git")).toContain("could not parse");
		expect(readFileSync(global, "utf8")).toBe("{ hand edited");
		expect(alwaysYes.has("bash", ["git"])).toBe(true);
	});

	test("an untrusted project holds it for this run without saving", () => {
		const alwaysYes = opened({ global });

		expect(alwaysYes.add("project", "bash", "git")).toContain("not trusted");
		expect(alwaysYes.has("bash", ["git"])).toBe(true);
		expect(existsSync(project)).toBe(false);
	});

	test("adopts a grants.json from before 3.0", () => {
		const legacy = join(dir, "global", "grants.json");
		write(legacy, JSON.stringify({ bash: ["git"] }));

		expect(opened().has("bash", ["git"])).toBe(true);
		expect(existsSync(legacy)).toBe(false);
		expect(onDisk(global)).toEqual({ bash: ["git"] });
	});

	test("forget clears a scope and deletes its file", () => {
		const alwaysYes = opened();
		alwaysYes.add("session", "bash", "ls");
		alwaysYes.add("global", "bash", "git");

		expect(alwaysYes.forget("global")).toEqual({ removed: 1, errors: [] });
		expect(existsSync(global)).toBe(false);
		expect(alwaysYes.total()).toBe(1);

		expect(alwaysYes.forget("all").removed).toBe(1);
		expect(alwaysYes.total()).toBe(0);
	});
});
