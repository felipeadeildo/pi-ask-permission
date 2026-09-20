import { describe, expect, test } from "bun:test";

import type { Theme } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, visibleWidth } from "@earendil-works/pi-tui";

import { AskDialog } from "../src/dialog.ts";
import type { GrantScope } from "../src/grants.ts";
import { type AskDecision, FALLBACK_OPTIONS } from "../src/options.ts";
import { deriveTarget } from "../src/targets.ts";

/** Colour-free stand-in; only fg/bold are ever called by the dialog. */
const theme = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
	italic: (text: string) => text,
	strikethrough: (text: string) => text,
} as unknown as Theme;

const KEYS = { up: "\x1b[A", down: "\x1b[B", enter: "\r", tab: "\t", esc: "\x1b" };

function open(toolName = "bash", input: unknown = { command: "git status --short" }) {
	const decisions: AskDecision[] = [];
	let renders = 0;
	const dialog = new AskDialog({
		theme,
		toolName,
		target: deriveTarget(toolName, input),
		requestRender: () => {
			renders++;
		},
		complete: (decision) => decisions.push(decision),
	});
	return { dialog, decisions, renders: () => renders };
}

function press(dialog: AskDialog, ...keys: string[]): void {
	for (const key of keys) dialog.handleInput(key);
}

function type(dialog: AskDialog, text: string): void {
	for (const char of text) dialog.handleInput(char);
}

const YES: AskDecision = { decision: "allow", note: undefined, remember: undefined };
const NO: AskDecision = { decision: "deny", note: undefined, remember: undefined };

describe("menu", () => {
	test("enter on the default row allows", () => {
		const { dialog, decisions } = open();
		press(dialog, KEYS.enter);
		expect(decisions).toEqual([YES]);
	});

	test("a digit moves the highlight without deciding", () => {
		const { dialog, decisions } = open();
		press(dialog, "3");
		expect(decisions).toEqual([]);
		press(dialog, KEYS.enter);
		expect(decisions).toEqual([NO]);
	});

	test("1 is yes, 3 is deny", () => {
		const first = open();
		press(first.dialog, "1", KEYS.enter);
		expect(first.decisions).toEqual([YES]);

		const second = open();
		press(second.dialog, "3", KEYS.enter);
		expect(second.decisions).toEqual([NO]);
	});

	test("esc denies", () => {
		const { dialog, decisions } = open();
		press(dialog, KEYS.esc);
		expect(decisions).toEqual([NO]);
	});

	test("unknown keys change nothing", () => {
		const { dialog, decisions } = open();
		press(dialog, "q", "9", "~");
		expect(decisions).toEqual([]);
	});
});

describe("always yes depth picker", () => {
	test("preselects the finest level", () => {
		const { dialog, decisions } = open();
		press(dialog, "2", KEYS.enter);
		expect(decisions).toEqual([]);
		press(dialog, KEYS.enter);
		expect(decisions).toEqual([
			{ decision: "allow", note: undefined, remember: "git status --short", scope: "session" },
		]);
	});

	test("arrows walk out to coarser levels", () => {
		const one = open();
		press(one.dialog, "2", KEYS.enter, KEYS.up, KEYS.enter);
		expect(one.decisions[0]?.remember).toBe("git status");

		const two = open();
		press(two.dialog, "2", KEYS.enter, KEYS.up, KEYS.up, KEYS.enter);
		expect(two.decisions[0]?.remember).toBe("git");
	});

	test("esc returns to the menu without deciding", () => {
		const { dialog, decisions } = open();
		press(dialog, "2", KEYS.enter, KEYS.esc);
		expect(decisions).toEqual([]);
		press(dialog, "3", KEYS.enter);
		expect(decisions).toEqual([NO]);
	});

	test("typing does not leak into a note while picking depth", () => {
		const { dialog, decisions } = open();
		press(dialog, "2", KEYS.enter);
		type(dialog, "zzz");
		press(dialog, KEYS.enter);
		expect(decisions).toEqual([
			{ decision: "allow", note: undefined, remember: "git status --short", scope: "session" },
		]);
	});

	test("a single-level target still offers a scope", () => {
		const { dialog, decisions } = open("todo", { items: [] });
		press(dialog, "2", KEYS.enter);
		expect(decisions).toEqual([]);
		press(dialog, KEYS.enter);
		expect(decisions).toEqual([
			{ decision: "allow", note: undefined, remember: "todo", scope: "session" },
		]);
	});
});

describe("grant scope", () => {
	test("tab cycles session, project, everywhere", () => {
		const steps: [string[], GrantScope][] = [
			[[], "session"],
			[[KEYS.tab], "project"],
			[[KEYS.tab, KEYS.tab], "global"],
			[[KEYS.tab, KEYS.tab, KEYS.tab], "session"],
		];

		for (const [tabs, expected] of steps) {
			const { dialog, decisions } = open();
			press(dialog, "2", KEYS.enter, ...tabs, KEYS.enter);
			expect(decisions[0]?.scope).toBe(expected);
		}
	});

	test("the picker shows the scope it will write", () => {
		const { dialog } = open();
		press(dialog, "2", KEYS.enter);
		expect(dialog.render(80).join("\n")).toContain("scope: this session");

		press(dialog, KEYS.tab);
		expect(dialog.render(80).join("\n")).toContain("scope: this project");

		press(dialog, KEYS.tab);
		expect(dialog.render(80).join("\n")).toContain("scope: everywhere");
	});

	test("a plain yes carries no scope", () => {
		const { dialog, decisions } = open();
		press(dialog, KEYS.enter);
		expect(decisions).toEqual([YES]);
	});
});

describe("tab followups", () => {
	test("adds a note to yes", () => {
		const { dialog, decisions } = open();
		press(dialog, KEYS.tab);
		type(dialog, "use pnpm");
		press(dialog, KEYS.enter);
		expect(decisions).toEqual([{ decision: "allow", note: "use pnpm", remember: undefined }]);
	});

	test("adds a reason to deny", () => {
		const { dialog, decisions } = open();
		press(dialog, "3", KEYS.tab);
		type(dialog, "force push");
		press(dialog, KEYS.enter);
		expect(decisions).toEqual([{ decision: "deny", note: "force push", remember: undefined }]);
	});

	test("digits typed into a note are text, not decisions", () => {
		const { dialog, decisions } = open();
		press(dialog, KEYS.tab);
		type(dialog, "3 items");
		press(dialog, KEYS.enter);
		expect(decisions).toEqual([{ decision: "allow", note: "3 items", remember: undefined }]);
	});

	test("tab toggles the editor off and on again keeping the draft", () => {
		const { dialog, decisions } = open();
		press(dialog, KEYS.tab);
		type(dialog, "draft");
		press(dialog, KEYS.tab);
		expect(decisions).toEqual([]);
		press(dialog, KEYS.tab, KEYS.enter);
		expect(decisions).toEqual([{ decision: "allow", note: "draft", remember: undefined }]);
	});

	test("esc while editing cancels the note, not the call", () => {
		const { dialog, decisions } = open();
		press(dialog, KEYS.tab);
		type(dialog, "oops");
		press(dialog, KEYS.esc);
		expect(decisions).toEqual([]);
		press(dialog, KEYS.esc);
		expect(decisions).toEqual([NO]);
	});

	test("an empty note is no note", () => {
		const { dialog, decisions } = open();
		press(dialog, KEYS.tab, KEYS.enter);
		expect(decisions).toEqual([YES]);
	});

	test("a note survives into the depth picker", () => {
		const { dialog, decisions } = open();
		press(dialog, KEYS.down, KEYS.tab);
		type(dialog, "careful");
		press(dialog, KEYS.enter);
		expect(decisions).toEqual([]);
		press(dialog, KEYS.up, KEYS.enter);
		expect(decisions).toEqual([
			{ decision: "allow", note: "careful", remember: "git status", scope: "session" },
		]);
	});

	test("a different row starts a fresh note", () => {
		const { dialog, decisions } = open();
		press(dialog, KEYS.tab);
		type(dialog, "first");
		press(dialog, KEYS.tab, KEYS.down, KEYS.tab);
		type(dialog, "second");
		press(dialog, KEYS.enter, KEYS.enter);
		expect(decisions).toEqual([
			{ decision: "allow", note: "second", remember: "git status --short", scope: "session" },
		]);
	});
});

describe("note navigation while editing", () => {
	test("arrows move the open note editor between rows", () => {
		const { dialog } = open();
		dialog.focused = true;
		press(dialog, KEYS.tab);
		type(dialog, "on yes");
		press(dialog, KEYS.down);

		const lines = dialog.render(80);
		const cursorLine = lines.find((line) => line.includes(CURSOR_MARKER));
		expect(cursorLine).toBeDefined();
		expect(cursorLine).toContain("always yes");
		expect(lines.join("\n")).toContain("yes, on yes");

		press(dialog, KEYS.up);
		const back = dialog.render(80).find((line) => line.includes(CURSOR_MARKER));
		expect(back).toContain("yes, on yes");
	});

	test("a draft stays visible after the editor closes", () => {
		const { dialog } = open();
		press(dialog, KEYS.tab);
		type(dialog, "keep");
		press(dialog, KEYS.tab);
		expect(dialog.render(80).join("\n")).toContain("yes, keep");
	});

	test("each row keeps its own draft while arrowing", () => {
		const { dialog, decisions } = open();
		press(dialog, KEYS.tab);
		type(dialog, "first");
		press(dialog, KEYS.down, KEYS.up, KEYS.enter);
		expect(decisions).toEqual([{ decision: "allow", note: "first", remember: undefined }]);
	});

	test("arrows wrap around while editing", () => {
		const { dialog, decisions } = open();
		press(dialog, KEYS.tab);
		type(dialog, "reason");
		press(dialog, KEYS.up, KEYS.enter);
		expect(decisions).toEqual([NO]);
	});

	test("typing still goes to the row the editor landed on", () => {
		const { dialog, decisions } = open();
		press(dialog, KEYS.tab);
		type(dialog, "first");
		press(dialog, KEYS.down);
		type(dialog, "second");
		press(dialog, KEYS.enter, KEYS.enter);
		expect(decisions).toEqual([
			{ decision: "allow", note: "second", remember: "git status --short", scope: "session" },
		]);
	});
});

describe("fallback options", () => {
	test("derives one row per base option, plain then note", () => {
		expect(FALLBACK_OPTIONS.map((option) => option.key)).toEqual(["1", "2", "3", "4", "5", "6"]);
		expect(FALLBACK_OPTIONS.map((option) => option.label)).toEqual([
			"yes",
			"yes, with a note",
			"always yes",
			"always yes, with a note",
			"deny",
			"deny, with a reason",
		]);
		expect(FALLBACK_OPTIONS.map((option) => [option.decision, option.always, option.note])).toEqual(
			[
				["allow", false, false],
				["allow", false, true],
				["allow", true, false],
				["allow", true, true],
				["deny", false, false],
				["deny", false, true],
			],
		);
	});
});

describe("rendering", () => {
	test("never emits a line wider than the terminal", () => {
		for (const width of [8, 12, 20, 40, 80, 200]) {
			for (const keys of [[], [KEYS.tab], ["2", KEYS.enter], ["3", KEYS.tab]]) {
				const { dialog } = open();
				press(dialog, ...keys);
				type(dialog, "some note text");
				for (const line of dialog.render(width)) {
					expect(visibleWidth(line)).toBeLessThanOrEqual(width);
				}
			}
		}
	});

	test("shows the typed note inline on its row", () => {
		const { dialog } = open();
		press(dialog, KEYS.tab);
		type(dialog, "hello");
		expect(dialog.render(80).join("\n")).toContain("yes, hello");
	});

	test("elides a long summary but keeps the start of it", () => {
		const long = Array.from({ length: 30 }, (_value, index) => `segment${index}`).join(" ");
		const { dialog } = open("bash", { command: long });
		const rendered = dialog.render(60).join("\n");
		expect(rendered).toContain("segment0");
		expect(rendered).toContain("...");
	});

	test("shows the command it is asking about", () => {
		const { dialog } = open();
		expect(dialog.render(80).join("\n")).toContain("git status --short");
	});

	test("places the hardware cursor through the note editor when focused", () => {
		const { dialog } = open();
		press(dialog, KEYS.tab);
		dialog.focused = true;
		expect(dialog.render(80).join("\n")).toContain(CURSOR_MARKER);
	});

	test("asks for a repaint after every keystroke", () => {
		const { dialog, renders } = open();
		const before = renders();
		press(dialog, "x", KEYS.down, KEYS.tab);
		expect(renders()).toBeGreaterThan(before + 2);
	});
});
