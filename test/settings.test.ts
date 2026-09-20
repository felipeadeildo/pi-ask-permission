import { describe, expect, test } from "bun:test";

import type { Theme } from "@earendil-works/pi-coding-agent";

import { DEFAULT_CONFIG, defaultJudge } from "#core/config/schema.ts";
import { buildJudgeSettings, JUDGE_SETTING_IDS, judgeValues } from "#ui/settings/judge.ts";
import { judgeToggleItem } from "#ui/settings/screen.ts";

function judgeScreen(): ReturnType<typeof buildJudgeSettings> {
	return buildJudgeSettings({
		config: defaultJudge(),
		theme: {} as Theme,
		piModels: [],
		save: () => {},
		editPolicy: () => {},
		editModel: () => {},
	});
}

describe("settings layout", () => {
	test("the enable toggle is a direct on/off row on the parent", () => {
		const off = judgeToggleItem(DEFAULT_CONFIG);
		expect(off.values).toEqual(["off", "on"]);
		expect(off.submenu).toBeUndefined();
		expect(off.currentValue).toBe("off");

		const enabled = { ...DEFAULT_CONFIG, judge: { ...defaultJudge(), enabled: true } };
		expect(judgeToggleItem(enabled).currentValue).toBe("on");
	});

	test("the child rows never repeat the enable toggle", () => {
		const ids = judgeScreen().items.map((item) => item.id);
		expect(ids).not.toContain("judge.enabled");
		expect(ids).toEqual(JUDGE_SETTING_IDS);
	});

	test("every child row explains itself", () => {
		for (const item of judgeScreen().items) {
			expect(item.label.trim().length).toBeGreaterThan(0);
			expect(item.description?.length ?? 0).toBeGreaterThan(0);
		}
	});

	test("the tools row cycles through every preset without sticking", () => {
		const config = defaultJudge();
		const screen = buildJudgeSettings({
			config,
			theme: {} as Theme,
			piModels: [],
			save: () => {},
			editPolicy: () => {},
			editModel: () => {},
		});
		const tools = screen.items.find((item) => item.id === "judge.tools");

		expect(tools?.values).toEqual(["Bash only", "Bash and file writes", "Every tool"]);
		for (const value of tools?.values ?? []) {
			screen.onChange("judge.tools", value);
			expect(judgeValues(config)["judge.tools"]).toBe(value);
		}
	});

	test("a hand-edited tools list reads as Custom", () => {
		expect(judgeValues({ ...defaultJudge(), tools: ["mcp_*"] })["judge.tools"]).toBe("Custom");
	});
});
