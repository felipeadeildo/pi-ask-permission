import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	GRANT_SCOPES,
	SCOPE_LABEL,
	deleteGrants,
	grantKey,
	grantsFileExists,
	loadGrants,
	saveGrants,
} from "../src/grants.ts";

let dir: string;
let file: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "pi-ask-grants-"));
	file = join(dir, "nested", "grants.json");
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("scope vocabulary", () => {
	test("cycle order runs narrowest to widest", () => {
		expect(GRANT_SCOPES).toEqual(["session", "project", "global"]);
	});

	test("every scope has a label", () => {
		for (const scope of GRANT_SCOPES) expect(SCOPE_LABEL[scope]).toBeTruthy();
	});
});

describe("loadGrants", () => {
	test("a missing file is an empty set, not an error", () => {
		const loaded = loadGrants(file);
		expect(loaded).toEqual({ grants: new Set(), found: false });
	});

	test("reads the on-disk shape into flat keys", () => {
		writeFileSync(join(dir, "grants.json"), JSON.stringify({ bash: ["git", "git status"] }));
		const loaded = loadGrants(join(dir, "grants.json"));
		expect(loaded.found).toBe(true);
		expect([...loaded.grants].toSorted()).toEqual([
			grantKey("bash", "git"),
			grantKey("bash", "git status"),
		]);
	});

	test("a malformed file warns and yields nothing", () => {
		writeFileSync(join(dir, "grants.json"), "{ nope");
		const loaded = loadGrants(join(dir, "grants.json"));
		expect(loaded.found).toBe(true);
		expect(loaded.grants.size).toBe(0);
		expect(loaded.warning).toContain("could not parse");
	});

	test("a non-object file warns", () => {
		writeFileSync(join(dir, "grants.json"), "[1, 2]");
		const loaded = loadGrants(join(dir, "grants.json"));
		expect(loaded.warning).toContain("must contain a JSON object");
	});

	test("ignores entries that are not string levels", () => {
		writeFileSync(
			join(dir, "grants.json"),
			JSON.stringify({ bash: ["git", 7, "", null], write: "not an array" }),
		);
		expect([...loadGrants(join(dir, "grants.json")).grants]).toEqual([grantKey("bash", "git")]);
	});
});

describe("saveGrants", () => {
	test("creates parent directories and round-trips", () => {
		const grants = new Set([grantKey("bash", "git status"), grantKey("write", "~/dev")]);
		expect(saveGrants(file, grants)).toBeUndefined();
		expect(grantsFileExists(file)).toBe(true);
		expect(loadGrants(file).grants).toEqual(grants);
	});

	test("writes a stable, readable shape", () => {
		saveGrants(
			file,
			new Set([grantKey("write", "b"), grantKey("bash", "z"), grantKey("bash", "a")]),
		);
		expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ bash: ["a", "z"], write: ["b"] });
	});

	test("saving an empty set leaves an empty object, not a broken file", () => {
		saveGrants(file, new Set());
		expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({});
		expect(loadGrants(file).grants.size).toBe(0);
	});
});

describe("deleteGrants", () => {
	test("removes the file", () => {
		saveGrants(file, new Set([grantKey("bash", "git")]));
		expect(deleteGrants(file)).toBeUndefined();
		expect(grantsFileExists(file)).toBe(false);
	});

	test("is a no-op when the file is already gone", () => {
		expect(deleteGrants(file)).toBeUndefined();
	});

	test("delete then load is an empty set", () => {
		saveGrants(file, new Set([grantKey("bash", "git")]));
		deleteGrants(file);
		expect(loadGrants(file)).toEqual({ grants: new Set(), found: false });
	});

	test("reports a failure instead of throwing", () => {
		// A directory cannot be removed by a file-removal call, so the error is
		// surfaced as a message rather than thrown at the caller.
		const busy = join(dir, "busy");
		mkdirSync(busy);
		writeFileSync(join(busy, "keep"), "x");

		expect(typeof deleteGrants(busy)).toBe("string");
	});
});

describe("grantKey", () => {
	test("cannot be spoofed by a crafted tool or level name", () => {
		// A tool named "bash\0git" must not produce a key that matches the pair
		// (bash, git). The separator is not reachable from a tool name a caller
		// could type, so the two keys stay distinct.
		expect(grantKey("bash", "git")).not.toBe(grantKey("bash\u0000git", ""));
	});

	test("distinguishes the same level under different tools", () => {
		expect(grantKey("bash", "git")).not.toBe(grantKey("sh", "git"));
	});
});
