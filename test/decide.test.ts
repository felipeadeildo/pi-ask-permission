import { describe, expect, test } from "bun:test";

import { defaultConfig, type PermissionConfig } from "#core/config/schema.ts";
import { decide, describeCall, type GateState, gateLayers, type Layer } from "#core/decide.ts";
import type { PermissionMode } from "#core/mode.ts";
import { createToolRegistry } from "#core/tools.ts";

const CWD = "/repo";

function gate(overrides: Partial<GateState> = {}): GateState {
	return { config: defaultConfig(), mode: "manual", isGranted: () => false, ...overrides };
}

async function decidedBy(
	toolName: string,
	input: unknown,
	state: GateState = gate(),
	extra: Layer[] = [],
): Promise<string | undefined> {
	const call = describeCall(createToolRegistry(), toolName, input, CWD, state.config);
	const decision = await decide(call, [...gateLayers(state), ...extra]);
	return decision.by;
}

function withOutside(outside: PermissionConfig["workspace"]["outside"]): PermissionConfig {
	const config = defaultConfig();
	return { ...config, workspace: { ...config.workspace, outside } };
}

describe("decide", () => {
	test("always yes wins before anything else", async () => {
		const state = gate({ isGranted: () => true });
		expect(await decidedBy("bash", { command: "cat /etc/passwd" }, state)).toBe("always yes");
	});

	test("a call outside the workspace stops at the workspace layer", async () => {
		const state = gate({ mode: "auto" });
		expect(await decidedBy("bash", { command: "cat /etc/passwd" }, state)).toBe("workspace");
	});

	test("outside allow lets the mode decide", async () => {
		const state = gate({ mode: "auto", config: withOutside("allow") });
		expect(await decidedBy("bash", { command: "cat /etc/passwd" }, state)).toBe("mode");
	});

	test.each<[PermissionMode, string, unknown, string | undefined]>([
		["auto", "bash", { command: "rm -rf build" }, "mode"],
		["accept-edits", "write", { path: "a.ts" }, "mode"],
		["manual", "read", { path: "a.ts" }, "allow list"],
		["manual", "bash", { command: "git status" }, "read-only bash"],
		["manual", "bash", { command: "rm -rf build" }, undefined],
	])("%s %s decides by %s", async (mode, toolName, input, layer) => {
		expect(await decidedBy(toolName, input, gate({ mode }))).toBe(layer);
	});

	test("a later layer runs only when the earlier ones pass", async () => {
		const seen: string[] = [];
		const spy: Layer = {
			name: "spy",
			decide: (call) => {
				seen.push(call.target.summary);
				return undefined;
			},
		};

		await decidedBy("bash", { command: "git status" }, gate(), [spy]);
		await decidedBy("bash", { command: "rm -rf build" }, gate(), [spy]);
		expect(seen).toEqual(["rm -rf build"]);
	});
});
