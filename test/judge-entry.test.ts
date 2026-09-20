import { describe, expect, test } from "bun:test";

import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";

import type { JudgeRecord } from "#core/judge/types.ts";
import { registerJudgeEntry, toRecords } from "#ui/judge-entry.ts";

/** Colour-free stand-in; only fg/bold are ever called by the card. */
const theme = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
} as unknown as Theme;

function record(overrides: Partial<JudgeRecord> = {}): JudgeRecord {
	return {
		backend: "jev",
		model: "test-model",
		answers: { verdict: { choice: "allow", confidence: 0.9 }, reversibility: 0.1 },
		elapsedMs: 12,
		at: 0,
		toolName: "bash",
		summary: "git status",
		action: "allow",
		reason: "read-only",
		...overrides,
	};
}

/** Captures the registered renderer so entries can be rendered as on resume. */
function renderer(): (data: unknown, expanded?: boolean) => Component | undefined {
	let registered:
		| ((
				entry: { data: unknown },
				options: { expanded: boolean },
				theme: Theme,
		  ) => Component | undefined)
		| undefined;
	const pi = {
		registerEntryRenderer: (_customType: string, render: typeof registered) => {
			registered = render;
		},
	} as unknown as ExtensionAPI;
	registerJudgeEntry(pi);
	return (data, expanded = false) => registered?.({ data }, { expanded }, theme);
}

const lines = (data: unknown, expanded = false): string[] =>
	renderer()(data, expanded)?.render(80) ?? [];

const targetColumn = (row: string | undefined) => row?.indexOf("git status");

describe("judge entry", () => {
	test("accepts the array shape written today", () => {
		expect(lines([record(), record({ toolName: "read" })])).toHaveLength(3);
	});

	test("renders a single record persisted before grouping", () => {
		const rendered = lines([record()]);
		expect(rendered).toHaveLength(1);
		expect(rendered[0]).toContain("approved");
		expect(rendered[0]).toContain("git status");
	});

	test("hides entries with no usable record", () => {
		expect(renderer()(undefined)).toBeUndefined();
		expect(renderer()([])).toBeUndefined();
		expect(renderer()(["junk", 42, null])).toBeUndefined();
	});

	test("keeps showing the rest when one record is malformed", () => {
		expect(toRecords([record(), { toolName: "bash" }])).toHaveLength(1);
	});

	test("degrades to a stub instead of throwing on drifted data", () => {
		const broken = { ...record(), answers: undefined } as unknown as JudgeRecord;
		expect(lines([broken])).toEqual(["pi-ask-permission \u00b7 judge \u00b7 unreadable entry"]);
	});

	test("shows the reason and signals only when expanded", () => {
		expect(lines([record()])[0]).not.toContain("read-only");
		expect(lines([record()], true)[1]).toContain("read-only");
		expect(lines([record()], true)[2]).toContain("reversibility");
	});

	test("keeps a space between the label, the tool, and the target", () => {
		expect(lines([record({ toolName: "webfetch" })])[0]).toContain(
			"\u25c8 approved webfetch git status",
		);
	});

	test("a lone `ask you` does not pay for another card's dry-run label", () => {
		expect(lines([record({ action: "ask" })])[0]).toContain("\u25c8 ask you bash git status");
	});

	test("aligns the target column on the widest label in the card", () => {
		const rendered = lines([record({ action: "ask", dryRun: true }), record({ toolName: "read" })]);
		expect(rendered[1]).toContain("\u25c8 would ask you bash git status");
		expect(targetColumn(rendered[1])).toBe(targetColumn(rendered[2]));
	});
});
