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
	test("cycles manual, accept edits, yolo, and back", () => {
		expect(nextMode("manual")).toBe("accept-edits");
		expect(nextMode("accept-edits")).toBe("yolo");
		expect(nextMode("yolo")).toBe("manual");
	});
});

describe("modeApproves", () => {
	test("yolo approves every tool", () => {
		expect(modeApproves("yolo", "bash")).toBe(true);
		expect(modeApproves("yolo", "read")).toBe(true);
	});

	test("accept edits approves writes and edits only", () => {
		expect(modeApproves("accept-edits", "edit")).toBe(true);
		expect(modeApproves("accept-edits", "write")).toBe(true);
		expect(modeApproves("accept-edits", "bash")).toBe(false);
	});

	test("manual approves nothing on its own", () => {
		expect(modeApproves("manual", "edit")).toBe(false);
		expect(modeApproves("manual", "write")).toBe(false);
		expect(modeApproves("manual", "bash")).toBe(false);
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
		expect(parseMode("yolo")).toBe("yolo");
		expect(parseMode("nope")).toBeUndefined();
	});
});
