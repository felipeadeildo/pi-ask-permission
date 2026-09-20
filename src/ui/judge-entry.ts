import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

import { judgeActionLabel, judgeSignalText, judgeStatText, oneLine } from "#core/judge/report.ts";
import type { JudgeRecord } from "#core/judge/types.ts";
import { NAME } from "#identity";

export const JUDGE_ENTRY = `${NAME}:judge`;

export function registerJudgeEntry(pi: ExtensionAPI): void {
	pi.registerEntryRenderer<JudgeRecord>(JUDGE_ENTRY, (entry, { expanded }, theme) => {
		const record = entry.data;
		if (!record) return undefined;

		const tone = toneFor(record);
		const action =
			theme.fg(tone, `\u25c6 ${judgeActionLabel(record)}`) +
			(record.dryRun ? theme.fg("muted", " (dry run)") : "");
		const call = `${theme.fg("muted", record.toolName)} ${theme.fg("text", oneLine(record.summary, 80))}`;

		const lines = [
			`${action}${theme.fg("dim", " \u00b7 ")}${call}${theme.fg("dim", ` \u00b7 ${judgeStatText(record)}`)}`,
		];

		if (record.action !== "allow") lines.push(`  ${theme.fg("dim", record.reason)}`);
		if (expanded) lines.push(`  ${theme.fg("dim", judgeSignalText(record))}`);

		return new Text(lines.join("\n"), 0, 0);
	});
}

export function appendJudgeEntry(pi: ExtensionAPI, record: JudgeRecord): void {
	pi.appendEntry(JUDGE_ENTRY, record);
}

function toneFor(record: JudgeRecord): "success" | "error" | "warning" {
	if (record.error) return "warning";
	if (record.action === "allow") return "success";
	if (record.action === "deny") return "error";
	return "warning";
}
