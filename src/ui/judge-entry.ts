import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

import { judgeActionLabel, judgeSignalText, judgeStatText, oneLine } from "#core/judge/report.ts";
import type { JudgeRecord } from "#core/judge/types.ts";
import { NAME } from "#identity";

export const JUDGE_ENTRY = `${NAME}:judge`;

const ACTION_COLUMN = 13;
const TOOL_COLUMN = 6;
const TARGET_COLUMN = 32;

export function registerJudgeEntry(pi: ExtensionAPI): void {
	pi.registerEntryRenderer<JudgeRecord[]>(JUDGE_ENTRY, (entry, { expanded }, theme) => {
		const records = entry.data;
		if (!records || records.length === 0) return undefined;
		return new Text(renderRecords(records, expanded, theme).join("\n"), 0, 0);
	});
}

export function appendJudgeEntry(pi: ExtensionAPI, records: JudgeRecord[]): void {
	pi.appendEntry(JUDGE_ENTRY, records);
}

function renderRecords(records: JudgeRecord[], expanded: boolean, theme: Theme): string[] {
	const lines: string[] = [];

	if (records.length > 1) {
		lines.push(
			theme.fg("accent", theme.bold(`${NAME} \u00b7 judge`)) +
				theme.fg("dim", ` \u00b7 ${records.length} decisions`),
		);
	}

	for (const record of records) {
		lines.push(renderRecord(record, theme));
		if (!expanded) continue;
		lines.push(`    ${theme.fg("dim", record.reason)}`);
		lines.push(`    ${theme.fg("dim", judgeSignalText(record))}`);
	}

	return lines;
}

function renderRecord(record: JudgeRecord, theme: Theme): string {
	const tone = toneFor(record);
	const marker = theme.fg(tone, "\u25c8");
	const action = theme.fg(tone, pad(judgeActionLabel(record), ACTION_COLUMN));
	const tool = theme.fg("muted", pad(record.toolName, TOOL_COLUMN));
	const target = theme.fg("text", pad(oneLine(record.summary, TARGET_COLUMN), TARGET_COLUMN));

	return `  ${marker} ${action}${tool}${target} ${theme.fg("dim", judgeStatText(record))}`;
}

function pad(text: string, width: number): string {
	return text.length >= width ? text : text + " ".repeat(width - text.length);
}

function toneFor(record: JudgeRecord): "success" | "error" | "warning" {
	if (record.error) return "warning";
	if (record.action === "allow") return "success";
	if (record.action === "deny") return "error";
	return "warning";
}
