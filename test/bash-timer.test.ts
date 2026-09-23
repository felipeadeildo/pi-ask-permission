import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
	ExtensionAPI,
	ExtensionContext,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";

import { registerBashTimer } from "#pi/bash-timer.ts";

let root: string;
let previousAgentDir: string | undefined;

beforeAll(() => {
	root = mkdtempSync(join(tmpdir(), "bash-timer-"));
	previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = join(root, "agent");

	mkdirSync(join(root, "project", ".pi"), { recursive: true });
	writeFileSync(
		join(root, "project", ".pi", "settings.json"),
		JSON.stringify({ shellCommandPrefix: "echo from-project-settings" }),
	);
});

afterAll(() => {
	if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
	rmSync(root, { recursive: true, force: true });
});

function registeredBash(): ToolDefinition {
	let tool: ToolDefinition | undefined;
	const pi = {
		on: () => () => {},
		registerTool: (definition: ToolDefinition) => {
			tool = definition;
		},
	} as unknown as ExtensionAPI;

	registerBashTimer(pi);
	if (!tool) throw new Error("bash was not registered");
	return tool;
}

async function run(trusted: boolean): Promise<string> {
	const ctx = {
		cwd: join(root, "project"),
		isProjectTrusted: () => trusted,
		sessionManager: { getSessionId: () => "session", getSessionFile: () => undefined },
	} as unknown as ExtensionContext;

	const result = await registeredBash().execute(
		"call",
		{ command: "echo from-command" },
		undefined,
		undefined,
		ctx,
	);
	return result.content.map((part) => (part.type === "text" ? part.text : "")).join("");
}

describe("bash override", () => {
	test("a trusted project's shell prefix runs, like pi's own bash", async () => {
		const output = await run(true);
		expect(output).toContain("from-project-settings");
		expect(output).toContain("from-command");
	});

	test("an untrusted project's shell prefix is ignored", async () => {
		const output = await run(false);
		expect(output).not.toContain("from-project-settings");
		expect(output).toContain("from-command");
	});
});
