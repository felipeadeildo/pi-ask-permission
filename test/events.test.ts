import { describe, expect, test } from "bun:test";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { defaultConfig } from "#core/config/schema.ts";
import { registerEvents } from "#pi/events.ts";
import type { SessionState } from "#pi/session.ts";

interface Entry {
	customType: string;
	data: unknown;
}

type Handler = (event: unknown, ctx: ExtensionContext) => unknown;

/**
 * A never-auto-approve rule makes the judge answer without a backend, so these
 * tests exercise the real `runJudge` path with no network or API key.
 */
function enabledJudge(): SessionState["config"] {
	const config = defaultConfig();
	return { ...config, judge: { ...config.judge, enabled: true, never: ["*"] } };
}

function harness() {
	const entries: Entry[] = [];
	const handlers = new Map<string, Handler>();

	const pi = {
		on: (name: string, handler: Handler) => {
			handlers.set(name, handler);
			return () => handlers.delete(name);
		},
		appendEntry: (customType: string, data: unknown) => {
			entries.push({ customType, data });
		},
	} as unknown as ExtensionAPI;

	const state = {
		config: enabledJudge(),
		configFile: "/dev/null",
		configWarnings: [],
		grants: { session: new Set<string>(), project: new Set<string>(), global: new Set<string>() },
		pendingNotes: new Map<string, string>(),
		judgeCache: new Map(),
		judgeLog: [],
		judgeWarned: new Set<string>(),
		judgeHealth: { failures: 0, retryAt: 0 },
		typing: {
			start: () => {},
			stop: () => {},
			pause: () => {},
			resume: () => {},
			waitUntilQuiet: async () => {},
		},
	} as unknown as SessionState;

	registerEvents(pi, state);

	const toolCall = handlers.get("tool_call");
	if (!toolCall) throw new Error("no tool_call handler");

	return { entries, toolCall };
}

/** `onDialog` runs when the permission dialog opens, before it is answered. */
function fakeContext(onDialog: () => void = () => {}): ExtensionContext {
	return {
		mode: "tui",
		hasUI: true,
		cwd: "/repo",
		signal: undefined,
		modelRegistry: {},
		ui: {
			notify: () => {},
			setStatus: () => {},
			custom: async () => {
				onDialog();
				return { decision: "allow" };
			},
		},
	} as unknown as ExtensionContext;
}

function judgeCall(id: string, command: string) {
	return { toolName: "bash", toolCallId: id, input: { command } };
}

describe("judge cards in the transcript", () => {
	test("the card is already there when the permission dialog opens", async () => {
		const { entries, toolCall } = harness();
		let cardsOnDialog = -1;

		await toolCall(
			judgeCall("call-1", "git push origin main"),
			fakeContext(() => {
				cardsOnDialog = entries.length;
			}),
		);

		expect(cardsOnDialog).toBe(1);
		expect(entries).toHaveLength(1);
		expect(entries[0]?.customType).toBe("pi-ask-permission:judge");
		expect(entries[0]?.data).toEqual([
			expect.objectContaining({ action: "ask", toolName: "bash" }),
		]);
	});

	test("each decision is written as it is made, not batched to the turn end", async () => {
		const { entries, toolCall } = harness();

		await toolCall(judgeCall("call-1", "git push origin main"), fakeContext());
		expect(entries).toHaveLength(1);

		await toolCall(judgeCall("call-2", "git push --force origin main"), fakeContext());
		expect(entries).toHaveLength(2);
	});
});
