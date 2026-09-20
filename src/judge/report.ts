/**
 * Judge reporting: the session audit trail and the plain-text summaries behind
 * `/perm judge log`. Kept out of the event wiring and the settings UI.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { NAME } from "../name.ts";
import type { JudgeRecord } from "./types.ts";

/** How many decisions the session keeps for `/perm judge log`. */
export const JUDGE_LOG_LIMIT = 50;

export function remember(record: JudgeRecord | undefined, log: JudgeRecord[]): void {
	if (!record) return;

	log.push(record);
	if (log.length > JUDGE_LOG_LIMIT) log.shift();
}

/** Warns once per error code, so a dead network does not spam every call. */
export function warnOnce(ctx: ExtensionContext, warned: Set<string>, record: JudgeRecord): void {
	const code = record.error ?? "error";
	if (warned.has(code)) return;

	warned.add(code);
	ctx.ui.notify(`${NAME}: ${record.reason}`, "warning");
}

export function judgeLogText(log: JudgeRecord[], limit = 10): string {
	if (log.length === 0) return `${NAME}: no judge decisions this session`;

	const lines = log.slice(-limit).toReversed().map(describeJudgeRecord);
	return [`${NAME}: ${log.length} judge decisions, newest first`, ...lines].join("\n");
}

export function describeJudgeRecord(record: JudgeRecord): string {
	const outcome = record.dryRun ? `would ${record.action}` : record.action;
	return `\u00b7 ${outcome} ${record.toolName}: ${oneLine(record.summary)} \u2014 ${record.reason} (${judgeDetail(record)})`;
}

function judgeDetail(record: JudgeRecord): string {
	if (record.error) return `error ${record.error}`;
	if (record.risk === undefined) return record.model;
	return `${record.model} \u00b7 risk ${record.risk.toFixed(2)}`;
}

export function oneLine(text: string, max = 60): string {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > max ? `${flat.slice(0, max - 3)}...` : flat;
}
