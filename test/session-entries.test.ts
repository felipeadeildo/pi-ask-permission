import { describe, expect, test } from "bun:test";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { AlwaysYes } from "#core/always-yes.ts";
import { defaultConfig } from "#core/config/schema.ts";
import { replay, restoreSession, SESSION_ENTRY, type SessionEntry } from "#pi/session-entries.ts";
import type { SessionState } from "#pi/session.ts";

function entry(data: SessionEntry | Record<string, unknown>, customType = SESSION_ENTRY) {
	return { type: "custom", customType, data };
}

describe("replay", () => {
	test("an empty branch starts from the configured mode", () => {
		expect(replay([], "manual")).toEqual({ mode: "manual", alwaysYes: [] });
	});

	test("the last mode wins", () => {
		const branch = [
			entry({ kind: "mode", mode: "auto" }),
			entry({ kind: "mode", mode: "accept-edits" }),
		];
		expect(replay(branch, "manual").mode).toBe("accept-edits");
	});

	test("forget drops the always yes before it, not after", () => {
		const branch = [
			entry({ kind: "always-yes", toolName: "bash", level: "git" }),
			entry({ kind: "forget-always-yes" }),
			entry({ kind: "always-yes", toolName: "bash", level: "pnpm test" }),
		];
		expect(replay(branch, "manual").alwaysYes).toEqual([{ toolName: "bash", level: "pnpm test" }]);
	});

	test("ignores other extensions' entries and malformed data", () => {
		const branch = [
			entry({ kind: "mode", mode: "auto" }, "someone-else"),
			entry({ kind: "mode", mode: "yolo" }),
			entry({ kind: "always-yes", toolName: "bash" }),
			{ type: "message", role: "user" },
			entry({ kind: "mode", mode: "auto" }, `${SESSION_ENTRY}-not`),
		];
		expect(replay(branch, "manual")).toEqual({ mode: "manual", alwaysYes: [] });
	});
});

describe("restoreSession", () => {
	test("rebuilds the mode and this session's always yes from the branch", () => {
		const state = {
			config: defaultConfig(),
			mode: "manual",
			alwaysYes: new AlwaysYes(),
		} as unknown as SessionState;
		state.alwaysYes.add("session", "bash", "from another branch");

		const branch = [
			entry({ kind: "mode", mode: "auto" }),
			entry({ kind: "always-yes", toolName: "bash", level: "git" }),
		];
		const ctx = { sessionManager: { getBranch: () => branch } } as unknown as ExtensionContext;
		restoreSession(state, ctx);

		expect(state.mode).toBe("auto");
		expect(state.alwaysYes.has("bash", ["git"])).toBe(true);
		expect(state.alwaysYes.has("bash", ["from another branch"])).toBe(false);
	});
});
