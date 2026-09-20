import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import { flatten, judgeActionLabel, judgeSignalText, judgeStatText } from "#core/judge/report.ts";
import type { JudgeRecord } from "#core/judge/types.ts";
import { NAME } from "#identity";

const JUDGE_ENTRY = `${NAME}:judge`;

const MIN_TARGET = 12;

interface Columns {
	action: number;
	tool: number;
}

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

/**
 * One entry per decision, written as soon as the judge answers. Waiting for
 * the turn to end held the card back until after execution, so a parallel
 * call hid every verdict behind the slowest command. The array shape is kept
 * because sessions written before this grouped a turn's records into one.
 */
export function appendJudgeEntry(pi: ExtensionAPI, record: JudgeRecord): void {
	pi.appendEntry(JUDGE_ENTRY, [record]);
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
		const columns = this.columns();

		if (this.records.length > 1) {
			lines.push(
				this.theme.fg("accent", this.theme.bold(`${NAME} \u00b7 judge`)) +
					this.theme.fg("dim", ` \u00b7 ${this.records.length} decisions`),
			);
		}

		for (const record of this.records) {
			lines.push(this.row(record, width, columns));
			if (!this.expanded) continue;
			lines.push(`    ${this.theme.fg("dim", record.reason)}`);
			lines.push(`    ${this.theme.fg("dim", judgeSignalText(record))}`);
		}

		return lines;
	}

	/**
	 * Widths come from this card's own records, so a lone `ask you` is not
	 * charged for a `would ask you` that lives in someone else's card. The
	 * extra column keeps at least one space before the next field: a tool
	 * named `webfetch` used to run straight into its target.
	 */
	private columns(): Columns {
		const action = Math.max(...this.records.map((r) => judgeActionLabel(r).length));
		const tool = Math.max(...this.records.map((r) => r.toolName.length));
		return { action: action + 1, tool: tool + 1 };
	}

	/** Stats hug the right edge, so the target uses whatever room is left. */
	private row(record: JudgeRecord, width: number, columns: Columns): string {
		const tone = toneFor(record);
		const action = judgeActionLabel(record).padEnd(columns.action);
		const tool = record.toolName.padEnd(columns.tool);
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
