import { describe, expect, test } from "bun:test";

import {
	MODE_LABEL,
	modeApproves,
	modeFromLabel,
	nextMode,
	parseMode,
	PERMISSION_MODES,
} from "#core/mode.ts";

describe("nextMode", () => {
	test("cycles manual, accept edits, auto, and back", () => {
		expect(nextMode("manual")).toBe("accept-edits");
		expect(nextMode("accept-edits")).toBe("auto");
		expect(nextMode("auto")).toBe("manual");
	});
});

describe("modeApproves", () => {
	test("auto approves every tool inside the workspace", () => {
		expect(modeApproves("auto", "bash", false)).toBe(true);
		expect(modeApproves("auto", "read", false)).toBe(true);
	});

	test("no mode approves a call that left the workspace", () => {
		for (const mode of PERMISSION_MODES) {
			expect(modeApproves(mode, "bash", true)).toBe(false);
			expect(modeApproves(mode, "edit", true)).toBe(false);
		}
	});

	test("accept edits approves writes and edits inside the workspace only", () => {
		expect(modeApproves("accept-edits", "edit", false)).toBe(true);
		expect(modeApproves("accept-edits", "write", false)).toBe(true);
		expect(modeApproves("accept-edits", "bash", false)).toBe(false);
	});

	test("manual approves nothing on its own", () => {
		expect(modeApproves("manual", "edit", false)).toBe(false);
		expect(modeApproves("manual", "write", false)).toBe(false);
		expect(modeApproves("manual", "bash", false)).toBe(false);
	});
});

describe("mode labels", () => {
	test("every mode round-trips through its label", () => {
		for (const mode of PERMISSION_MODES) {
			expect(modeFromLabel(MODE_LABEL[mode])).toBe(mode);
		}
	});

	test("parseMode tolerates spellings", () => {
		expect(parseMode("accept")).toBe("accept-edits");
		expect(parseMode("edits")).toBe("accept-edits");
		expect(parseMode("auto")).toBe("auto");
		expect(parseMode("yolo")).toBeUndefined();
		expect(parseMode("nope")).toBeUndefined();
	});
});
