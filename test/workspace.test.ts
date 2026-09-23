import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEFAULT_WORKSPACE, type WorkspaceConfig } from "#core/config/schema.ts";
import { asToolInput, createToolRegistry } from "#core/tools.ts";
import { checkWorkspace, resolveRoots } from "#core/workspace.ts";

function workspace(overrides: Partial<WorkspaceConfig> = {}): WorkspaceConfig {
	return { ...DEFAULT_WORKSPACE, ...overrides };
}

let root: string;
let outside: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "pi-ask-ws-"));
	outside = mkdtempSync(join(tmpdir(), "pi-ask-outside-"));
	mkdirSync(join(root, "src"));
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
	rmSync(outside, { recursive: true, force: true });
});

describe("resolveRoots", () => {
	test("resolves a relative root against the cwd", () => {
		expect(resolveRoots(["."], root)).toEqual([root]);
		expect(resolveRoots(["src"], root)).toEqual([join(root, "src")]);
	});

	test("falls back to the cwd for an empty list", () => {
		expect(resolveRoots([], root)).toEqual([root]);
	});
});

describe("file tools", () => {
	test("reads the path argument", () => {
		expect(outcome("read", { path: "src/a.ts" })).toEqual({ outside: false });
		expect(outcome("write", { path: join(root, "a.ts") })).toEqual({ outside: false });
		expect(outcome("edit", { path: join(outside, "a.ts") }).outside).toBe(true);
	});

	test("resolves a relative parent", () => {
		expect(outcome("read", { path: "../x" }).outside).toBe(true);
	});

	test("a tool with no path reads the cwd", () => {
		expect(outcome("read", {})).toEqual({ outside: false });
	});

	test("a tool with no path follows a root that is not the cwd", () => {
		const config = workspace({ roots: [outside] });
		expect(outcome("ls", {}, config).outside).toBe(true);
	});

	test("a tool whose paths are unknown is left alone", () => {
		expect(outcome("mcp_github", { query: "x" })).toEqual({ outside: false });
	});

	test("a symlink out of the project does not read as inside", () => {
		symlinkSync(outside, join(root, "link"));
		expect(outcome("read", { path: "link/a.ts" }).outside).toBe(true);
	});

	test("a symlink stays inside when it points inside", () => {
		symlinkSync(join(root, "src"), join(root, "link"));
		expect(outcome("read", { path: "link/a.ts" })).toEqual({ outside: false });
	});
});

describe("bash", () => {
	test("a path literal decides", () => {
		expect(outcome("bash", { command: "cat src/a.ts" })).toEqual({ outside: false });
		expect(outcome("bash", { command: "cat /etc/passwd" }).outside).toBe(true);
		expect(outcome("bash", { command: "cat ../x" }).outside).toBe(true);
		expect(outcome("bash", { command: "cd .. && cat x" }).outside).toBe(true);
	});

	test("a command with no path in it stays inside", () => {
		expect(outcome("bash", { command: "pnpm test" })).toEqual({ outside: false });
		expect(outcome("bash", { command: "rm -rf build" })).toEqual({ outside: false });
	});

	test("a loop resolves its variable", () => {
		expect(
			outcome("bash", {
				command: `for f in src/a.ts src/b.ts; do echo "== $f =="; cat "$f"; done`,
			}),
		).toEqual({ outside: false });
		expect(outcome("bash", { command: `for f in /etc/passwd; do cat "$f"; done` }).outside).toBe(
			true,
		);
	});

	test("a reference the loop does not own is opaque", () => {
		expect(outcome("bash", { command: `cat "$HOME/.ssh/id_rsa"` }).outside).toBe(true);
		expect(outcome("bash", { command: `for f in src; do cat "$g"; done` }).outside).toBe(true);
		expect(outcome("bash", { command: `for f in "$@"; do cat "$f"; done` }).outside).toBe(true);
	});

	test("single quotes hold no reference", () => {
		expect(outcome("bash", { command: "grep -n '$foo' src/a.ts" })).toEqual({ outside: false });
	});

	test("a path tied to a flag is still a path", () => {
		expect(outcome("bash", { command: "sort --output=/tmp/x src/a.ts" }).outside).toBe(true);
	});

	test("a pasted image in the temp dir is not a trip outside", () => {
		const pasted = join(tmpdir(), `pi-clipboard-${crypto.randomUUID()}.png`);
		expect(outcome("read", { path: pasted })).toEqual({ outside: false });
		expect(outcome("bash", { command: `cat ${pasted}` })).toEqual({ outside: false });
		expect(outcome("read", { path: join(tmpdir(), "other.png") }).outside).toBe(true);
		expect(outcome("read", { path: join(tmpdir(), "sub", "pi-clipboard-x.png") }).outside).toBe(
			true,
		);
	});
});

describe("roots", () => {
	test("an extra root widens the workspace", () => {
		const config = workspace({ roots: [".", outside] });
		expect(outcome("read", { path: join(outside, "a.ts") }, config).outside).toBe(false);
	});

	test("a root expands a home prefix", () => {
		const roots = resolveRoots(["~"], root);
		const home = process.env.HOME;
		if (home) expect(roots[0]).toBe(realpathSync(home));
	});

	test("a root of / holds every path", () => {
		expect(outcome("read", { path: "/etc" }, workspace({ roots: ["/"] })).outside).toBe(false);
	});
});

function outcome(
	toolName: string,
	input: unknown,
	config: WorkspaceConfig = workspace(),
): { outside: boolean } {
	const paths = createToolRegistry().get(toolName).paths(asToolInput(input));
	const verdict = checkWorkspace(config, root, paths);
	return verdict.path === undefined ? { outside: verdict.outside } : verdict;
}
