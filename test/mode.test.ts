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
	test("auto approves every tool", () => {
		expect(modeApproves("auto", false)).toBe(true);
		expect(modeApproves("auto", true)).toBe(true);
	});

	test("accept edits approves edits only", () => {
		expect(modeApproves("accept-edits", true)).toBe(true);
		expect(modeApproves("accept-edits", false)).toBe(false);
	});

	test("manual approves nothing on its own", () => {
		expect(modeApproves("manual", true)).toBe(false);
		expect(modeApproves("manual", false)).toBe(false);
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
