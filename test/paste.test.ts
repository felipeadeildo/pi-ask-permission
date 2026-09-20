import { describe, expect, test } from "bun:test";

import { cleanPaste, expandPastes, pasteMarker, shouldCollapse } from "#ui/paste.ts";

describe("cleanPaste", () => {
	test("normalizes line endings and expands tabs", () => {
		expect(cleanPaste("a\r\nb\rc\td")).toBe("a\nb\nc    d");
	});

	test("drops control characters but keeps newlines", () => {
		expect(cleanPaste("a\x01b\nc")).toBe("ab\nc");
	});
});

describe("shouldCollapse", () => {
	test("collapses a newline or a wall of text", () => {
		expect(shouldCollapse("one line")).toBe(false);
		expect(shouldCollapse("a\nb")).toBe(true);
		expect(shouldCollapse("x".repeat(1001))).toBe(true);
	});
});

describe("pasteMarker", () => {
	test("reports lines or chars", () => {
		expect(pasteMarker(1, "a\nb\nc")).toBe("[paste #1 +3 lines]");
		expect(pasteMarker(2, "x".repeat(1001))).toBe("[paste #2 1001 chars]");
	});
});

describe("expandPastes", () => {
	test("puts the pasted text back", () => {
		const pastes = new Map([[1, "a\nb"]]);
		expect(expandPastes("see [paste #1 +2 lines] please", pastes)).toBe("see a\nb please");
	});

	test("leaves an unknown marker alone", () => {
		expect(expandPastes("[paste #9 +2 lines]", new Map())).toBe("[paste #9 +2 lines]");
	});
});
