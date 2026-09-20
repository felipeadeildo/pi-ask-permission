import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import { flatten, judgeActionLabel, judgeSignalText, judgeStatText } from "#core/judge/report.ts";
import type { JudgeRecord } from "#core/judge/types.ts";
import { NAME } from "#identity";

const JUDGE_ENTRY = `${NAME}:judge`;

const ACTION_COLUMN = 13;
const TOOL_COLUMN = 6;
const MIN_TARGET = 12;

export function registerJudgeEntry(pi: ExtensionAPI): void {
	pi.registerEntryRenderer<unknown>(JUDGE_ENTRY, (entry, { expanded }, theme) => {
		const records = toRecords(entry.data);
		if (records.length === 0) return undefined;
		return new JudgeEntry(records, expanded, theme);
	});
}

/** Early versions persisted one record per entry; now a turn's records share one. */
export function toRecords(data: unknown): JudgeRecord[] {
	const list = Array.isArray(data) ? data : [data];
	return list.filter(isJudgeRecord);
}

function isJudgeRecord(value: unknown): value is JudgeRecord {
	if (typeof value !== "object" || value === null) return false;
	const record = value as Partial<JudgeRecord>;
	return typeof record.summary === "string" && typeof record.toolName === "string";
}

export function appendJudgeEntry(pi: ExtensionAPI, records: JudgeRecord[]): void {
	pi.appendEntry(JUDGE_ENTRY, records);
}

class JudgeEntry implements Component {
	constructor(
		private readonly records: JudgeRecord[],
		private readonly expanded: boolean,
		private readonly theme: Theme,
	) {}

	invalidate(): void {}

	/** A throw here kills the whole TUI, so a drifted entry degrades to a stub. */
	render(width: number): string[] {
		try {
			return this.build(width);
		} catch {
			return [this.theme.fg("dim", `${NAME} \u00b7 judge \u00b7 unreadable entry`)];
		}
	}

	private build(width: number): string[] {
		const lines: string[] = [];

		if (this.records.length > 1) {
			lines.push(
				this.theme.fg("accent", this.theme.bold(`${NAME} \u00b7 judge`)) +
					this.theme.fg("dim", ` \u00b7 ${this.records.length} decisions`),
			);
		}

		for (const record of this.records) {
			lines.push(this.row(record, width));
			if (!this.expanded) continue;
			lines.push(`    ${this.theme.fg("dim", record.reason)}`);
			lines.push(`    ${this.theme.fg("dim", judgeSignalText(record))}`);
		}

		return lines;
	}

	/** Stats hug the right edge, so the target uses whatever room is left. */
	private row(record: JudgeRecord, width: number): string {
		const tone = toneFor(record);
		const action = judgeActionLabel(record).padEnd(ACTION_COLUMN);
		const tool = record.toolName.padEnd(TOOL_COLUMN);
		const stats = judgeStatText(record);

		const head = `  \u25c8 ${action}${tool}`;
		const room = width - visibleWidth(head) - visibleWidth(stats) - 1;
		const target = truncateToWidth(flatten(record.summary), Math.max(MIN_TARGET, room), "...");
		const gap = Math.max(
			1,
			width - visibleWidth(head) - visibleWidth(target) - visibleWidth(stats),
		);

		return (
			`  ${this.theme.fg(tone, "\u25c8")} ` +
			this.theme.fg(tone, action) +
			this.theme.fg("muted", tool) +
			this.theme.fg("text", target) +
			" ".repeat(gap) +
			this.theme.fg("dim", stats)
		);
	}
}

function toneFor(record: JudgeRecord): "success" | "error" | "warning" {
	if (record.error) return "warning";
	if (record.action === "allow") return "success";
	if (record.action === "deny") return "error";
	return "warning";
}
