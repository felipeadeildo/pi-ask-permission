import { expect, test } from "bun:test";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { type ToolAdapter, toolAdapter } from "#core/tools.ts";
import { listenForTools, TOOL_EVENT } from "#pi/api.ts";

function bus() {
	const handlers: ((data: unknown) => void)[] = [];
	const pi = {
		events: {
			on: (_channel: string, handler: (data: unknown) => void) => handlers.push(handler),
			emit: (_channel: string, data: unknown) => {
				for (const handler of handlers) handler(data);
			},
		},
	} as unknown as ExtensionAPI;
	const tools = new Map<string, Partial<ToolAdapter>>();
	listenForTools(pi, tools);
	return { tools, emit: (data: unknown) => pi.events.emit(TOOL_EVENT, data) };
}

test("another extension describes its own tool", () => {
	const { tools, emit } = bus();
	emit({ name: "apply_patch", edits: true, paths: () => ["src/a.ts"] });

	const adapter = toolAdapter("apply_patch", tools);
	expect(adapter.edits).toBe(true);
	expect(adapter.paths({})).toEqual(["src/a.ts"]);
	expect(adapter.describe({}).levels).toEqual(["apply_patch"]);
});

test("a built-in tool cannot be redescribed", () => {
	const { tools, emit } = bus();
	emit({ name: "bash", paths: () => [] });
	emit({ name: 42 });

	expect(tools.size).toBe(0);
});
