import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { configPath } from "#core/config/store.ts";

import piAskPermission from "../src/index.ts";

let dir: string;
let previous: string | undefined;

beforeEach(() => {
	previous = process.env.PI_CODING_AGENT_DIR;
	dir = mkdtempSync(join(tmpdir(), "pi-ask-index-"));
	process.env.PI_CODING_AGENT_DIR = dir;
});

afterEach(() => {
	if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previous;
	rmSync(dir, { recursive: true, force: true });
});

test("loading the extension writes nothing until a session starts", async () => {
	const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>();
	const pi = new Proxy(
		{
			on: (name: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) =>
				handlers.set(name, handler),
		},
		{ get: (target, key) => (key in target ? target[key as "on"] : () => {}) },
	) as unknown as ExtensionAPI;

	piAskPermission(pi);
	expect(existsSync(configPath())).toBe(false);

	const ctx = {
		mode: "print",
		hasUI: false,
		cwd: dir,
		isProjectTrusted: () => false,
		sessionManager: { getBranch: () => [] },
		ui: { notify: () => {}, setStatus: () => {} },
	} as unknown as ExtensionContext;
	await handlers.get("session_start")?.({}, ctx);
	expect(existsSync(configPath())).toBe(true);
});
