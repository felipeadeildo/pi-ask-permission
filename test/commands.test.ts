import { describe, expect, test } from "bun:test";

import type {
	ExtensionAPI,
	ExtensionCommandContext,
	RegisteredCommand,
} from "@earendil-works/pi-coding-agent";

import { AlwaysYes } from "#core/always-yes.ts";
import { defaultConfig } from "#core/config/schema.ts";
import { registerCommands } from "#pi/commands.ts";
import type { SessionState } from "#pi/session.ts";

function perm() {
	let command: Omit<RegisteredCommand, "name" | "sourceInfo"> | undefined;
	const pi = {
		registerCommand: (_name: string, options: typeof command) => {
			command = options;
		},
		registerShortcut: () => {},
		appendEntry: () => {},
	} as unknown as ExtensionAPI;

	const state = {
		config: defaultConfig(),
		mode: "manual",
		alwaysYes: new AlwaysYes(),
	} as unknown as SessionState;
	registerCommands(pi, state);
	if (!command) throw new Error("/perm was not registered");

	const notes: string[] = [];
	const ctx = {
		mode: "print",
		hasUI: false,
		cwd: "/repo",
		ui: { notify: (text: string) => notes.push(text), setStatus: () => {} },
	} as unknown as ExtensionCommandContext;

	return { command, state, notes, run: (args: string) => command?.handler(args, ctx) };
}

describe("/perm", () => {
	test("suggests every subcommand that starts with what was typed", async () => {
		const { command } = perm();
		const values = async (prefix: string) =>
			((await command.getArgumentCompletions?.(prefix)) ?? []).map((item) => item.value);

		expect(await values("fo")).toEqual([
			"forget",
			"forget project",
			"forget everywhere",
			"forget all",
		]);
		expect(await values("judge t")).toEqual(["judge test"]);
		expect(await values("nope")).toEqual([]);
	});

	test("forget uses the dialog's scope names", async () => {
		const { state, notes, run } = perm();
		state.alwaysYes.add("session", "bash", "git");

		await run("forget");
		expect(state.alwaysYes.total()).toBe(0);
		expect(notes.at(-1)).toContain("forgot 1 always yes from this session");

		await run("forget global");
		expect(notes.at(-1)).toContain("forget takes session, project, everywhere, all");
	});

	test("an unknown subcommand lists the real ones", async () => {
		const { notes, run } = perm();
		await run("reset");
		expect(notes.at(-1)).toContain("/perm takes mode, status, forget, judge");
	});
});
