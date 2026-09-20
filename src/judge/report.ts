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
	if (record.error) return `error ${record.error} \u00b7 ${record.elapsedMs}ms`;
	const risk = record.risk === undefined ? "" : ` \u00b7 risk ${record.risk.toFixed(2)}`;
	return `${record.model} \u00b7 ${record.elapsedMs}ms${risk}`;
}

/** `would allow`, `deny`, `ask you` \u2014 the verb a reader expects. */
export function judgeActionLabel(record: JudgeRecord): string {
	if (record.action === "allow") return record.dryRun ? "would allow" : "allow";
	if (record.action === "deny") return record.dryRun ? "would deny" : "deny";
	return "ask you";
}

/** One line: what the judge said, how sure it was, and how it went. */
export function judgeVerdictText(record: JudgeRecord): string {
	const parts = [judgeActionLabel(record)];

	const confidence = record.answers.verdict?.confidence;
	if (confidence !== undefined) parts.push(`${Math.round(confidence * 100)}% confident`);
	if (record.error) parts.push(`error ${record.error}`);
	if (record.risk !== undefined) parts.push(`risk ${record.risk.toFixed(2)}`);
	parts.push(record.model, `${record.elapsedMs}ms`);

	return parts.join(" \u00b7 ");
}

/** The signals behind the verdict, in a stable order. */
export function judgeSignalText(record: JudgeRecord): string {
	const answers = record.answers;
	const parts: string[] = [];

	if (answers.intent_match !== undefined) parts.push(`intent ${answers.intent_match.toFixed(2)}`);
	if (answers.reversibility !== undefined)
		parts.push(`reversibility ${answers.reversibility.toFixed(2)}`);
	if (answers.sensitive_access !== undefined)
		parts.push(`sensitive ${answers.sensitive_access.toFixed(2)}`);
	if (answers.outside_workspace !== undefined)
		parts.push(`outside ${answers.outside_workspace.toFixed(2)}`);

	return parts.join(" \u00b7 ") || "no signals";
}

export function oneLine(text: string, max = 60): string {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > max ? `${flat.slice(0, max - 3)}...` : flat;
}
