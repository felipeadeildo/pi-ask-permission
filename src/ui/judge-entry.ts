/**
 * The judge's decision, rendered inline in the transcript. Custom entries do
 * not reach the model, so this is a pure audit view: what the judge said, how
 * sure it was, and the signals behind it.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

import { judgeSignalText, judgeVerdictText, oneLine } from "#core/judge/report.ts";
import type { JudgeRecord } from "#core/judge/types.ts";
import { NAME } from "#identity";

export const JUDGE_ENTRY = `${NAME}:judge`;

export function registerJudgeEntry(pi: ExtensionAPI): void {
	pi.registerEntryRenderer<JudgeRecord>(JUDGE_ENTRY, (entry, { expanded }, theme) => {
		const record = entry.data;
		if (!record) return undefined;

		const tone = toneFor(record);
		const lines = [
			theme.fg("accent", theme.bold(`${NAME} \u00b7 judge`)) +
				(record.dryRun ? theme.fg("muted", " \u00b7 dry run") : ""),
			`  ${theme.fg("muted", record.toolName)}  ${theme.fg("dim", oneLine(record.summary, 100))}`,
			`  ${theme.fg(tone, judgeVerdictText(record))}`,
		];

		if (expanded) {
			lines.push(`  ${theme.fg("dim", record.reason)}`);
			lines.push(`  ${theme.fg("dim", judgeSignalText(record))}`);
		}

		return new Text(lines.join("\n"), 0, 0);
	});
}

export function appendJudgeEntry(pi: ExtensionAPI, record: JudgeRecord): void {
	pi.appendEntry(JUDGE_ENTRY, record);
}

/**
 * A verdict worth a line in the transcript: anything the user did not see a
 * dialog for. A quiet approval in normal mode stays only in `/perm judge log`.
 */
export function judgeEntryWorthShowing(record: JudgeRecord): boolean {
	return record.dryRun === true || record.action !== "allow";
}

function toneFor(record: JudgeRecord): "success" | "error" | "warning" {
	if (record.error) return "warning";
	if (record.action === "allow") return "success";
	if (record.action === "deny") return "error";
	return "warning";
}
