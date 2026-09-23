import { describe, expect, test } from "bun:test";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { defaultConfig } from "#core/config/schema.ts";
import type { OutsideScope } from "#core/config/schema.ts";
import { grantKey } from "#core/grants.ts";
import type { PermissionMode } from "#core/mode.ts";
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

function harness(mode: PermissionMode = "manual", outside: OutsideScope = "ask") {
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
		config: { ...enabledJudge(), workspace: { roots: ["."], outside } },
		mode,
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

	return { entries, state, toolCall };
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

function writeCall(id: string, path = "a.ts") {
	return { toolName: "write", toolCallId: id, input: { path, content: "x" } };
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

describe("session modes", () => {
	test("auto runs a bash call without opening the dialog", async () => {
		const { toolCall } = harness("auto");
		let opened = false;

		const result = await toolCall(
			judgeCall("call-1", "rm -rf build"),
			fakeContext(() => {
				opened = true;
			}),
		);

		expect(result).toBeUndefined();
		expect(opened).toBe(false);
	});

	test("accept edits runs a write without opening the dialog", async () => {
		const { toolCall } = harness("accept-edits");
		let opened = false;

		const result = await toolCall(
			writeCall("call-1"),
			fakeContext(() => {
				opened = true;
			}),
		);

		expect(result).toBeUndefined();
		expect(opened).toBe(false);
	});

	test("accept edits still gates bash", async () => {
		const { toolCall } = harness("accept-edits");
		let opened = false;

		await toolCall(
			judgeCall("call-1", "git push origin main"),
			fakeContext(() => {
				opened = true;
			}),
		);

		expect(opened).toBe(true);
	});

	test("manual gates a write", async () => {
		const { toolCall } = harness("manual");
		let opened = false;

		await toolCall(
			writeCall("call-1"),
			fakeContext(() => {
				opened = true;
			}),
		);

		expect(opened).toBe(true);
	});
});

describe("workspace scope", () => {
	test("auto does not approve a call outside the workspace", async () => {
		const { entries, toolCall } = harness("auto");
		let opened = false;

		await toolCall(
			judgeCall("call-1", "cat /etc/passwd"),
			fakeContext(() => {
				opened = true;
			}),
		);

		expect(opened).toBe(true);
		expect(entries).toHaveLength(0);
	});

	test("accept edits does not approve a write outside the workspace", async () => {
		const { toolCall } = harness("accept-edits");
		let opened = false;

		await toolCall(
			writeCall("call-1", "/etc/hosts"),
			fakeContext(() => {
				opened = true;
			}),
		);

		expect(opened).toBe(true);
	});

	test("a reference resolves through the loop that owns it", async () => {
		const { toolCall } = harness("auto");
		let opened = false;

		const result = await toolCall(
			judgeCall("call-1", `for f in src/a.ts src/b.ts; do cat "$f"; done`),
			fakeContext(() => {
				opened = true;
			}),
		);

		expect(result).toBeUndefined();
		expect(opened).toBe(false);
	});

	test("a reference the loop cannot resolve still asks", async () => {
		const { toolCall } = harness("auto");
		let opened = false;

		await toolCall(
			judgeCall("call-1", `cat "$SECRET"`),
			fakeContext(() => {
				opened = true;
			}),
		);

		expect(opened).toBe(true);
	});

	test("a grant still wins over the boundary", async () => {
		const { state, toolCall } = harness("manual");
		let opened = false;
		state.grants.session.add(grantKey("bash", "cat /etc/passwd"));

		const result = await toolCall(
			judgeCall("call-1", "cat /etc/passwd"),
			fakeContext(() => {
				opened = true;
			}),
		);

		expect(result).toBeUndefined();
		expect(opened).toBe(false);
	});

	test("outside deny blocks before the dialog", async () => {
		const { entries, toolCall } = harness("auto", "deny");

		const result = await toolCall(judgeCall("call-1", "cat /etc/passwd"), fakeContext());

		expect(result).toEqual({ block: true, reason: expect.stringContaining("/etc/passwd") });
		expect(entries).toHaveLength(0);
	});

	test("outside allow is what yolo used to be", async () => {
		const { toolCall } = harness("auto", "allow");
		let opened = false;

		const result = await toolCall(
			judgeCall("call-1", "cat /etc/passwd"),
			fakeContext(() => {
				opened = true;
			}),
		);

		expect(result).toBeUndefined();
		expect(opened).toBe(false);
	});
});
