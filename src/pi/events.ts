import {
	type ExtensionAPI,
	type ExtensionContext,
	isToolCallEventType,
	type ToolCallEvent,
} from "@earendil-works/pi-coding-agent";

import { SCOPE_LABEL } from "#core/always-yes.ts";
import type { DialogAnswer } from "#core/answer.ts";
import { noUIMode } from "#core/config/patterns.ts";
import {
	type Call,
	decide,
	describeCall,
	gateLayers,
	type Layer,
	type Verdict,
} from "#core/decide.ts";
import { judgeGate } from "#core/judge/gate.ts";
import { judgeVerdictText, remember, warnOnce } from "#core/judge/report.ts";
import type { CallDescriptor } from "#core/tools.ts";
import { NAME } from "#identity";
import { announce, type Decided } from "#pi/api.ts";
import { clearModeStatus, renderModeStatus } from "#pi/mode.ts";
import { editFailure } from "#pi/preflight.ts";
import { restoreSession } from "#pi/session-entries.ts";
import {
	loadSessionConfig,
	openAlwaysYes,
	noteJudgeFailure,
	rememberAlwaysYes,
	resetJudgeHealth,
	type SessionState,
} from "#pi/session.ts";
import { AskDialog } from "#ui/dialog.ts";
import { appendJudgeEntry } from "#ui/judge-entry.ts";
import { askViaSelector } from "#ui/selector.ts";
import { notifyJudgePolicyWarning } from "#ui/settings/status.ts";

const JUDGE_STATUS = `${NAME}:judge`;
const TYPING_STATUS = "waiting for you to finish typing";

export function registerEvents(pi: ExtensionAPI, state: SessionState): void {
	pi.on("session_start", (_event, ctx) => {
		loadSessionConfig(state, ctx);
		openAlwaysYes(state, ctx);
		restoreSession(state, ctx);
		notifyJudgePolicyWarning(state.config, ctx);
		renderModeStatus(ctx, state.mode, state.config.workspace.outside);
		state.typing.start(ctx);
	});

	pi.on("session_tree", (_event, ctx) => {
		restoreSession(state, ctx);
		renderModeStatus(ctx, state.mode, state.config.workspace.outside);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		clearModeStatus(ctx);
		state.typing.stop();
	});

	pi.on("tool_call", async (event, ctx) => {
		const call = describeCall(
			event.toolName,
			event.input,
			ctx.cwd,
			state.config,
			state.customTools,
		);
		const outcome = await gate(pi, state, ctx, call, event);

		announce(pi, {
			toolCallId: event.toolCallId,
			toolName: call.toolName,
			summary: call.target.summary,
			...outcome,
		});
		if (outcome.action === "block") return { block: true, reason: outcome.reason };

		if (outcome.note) {
			if (state.config.notes === "message") sendNote(pi, outcome.note, call.toolName);
			else state.pendingNotes.set(event.toolCallId, outcome.note);
		}
		return undefined;
	});

	pi.on("tool_result", (event) => {
		const note = state.pendingNotes.get(event.toolCallId);
		if (!note) return undefined;

		state.pendingNotes.delete(event.toolCallId);
		return { content: [...event.content, { type: "text", text: noteBlock(note) }] };
	});
}

type Outcome = Pick<Decided, "action" | "by" | "reason" | "note">;

async function gate(
	pi: ExtensionAPI,
	state: SessionState,
	ctx: ExtensionContext,
	call: Call,
	event: ToolCallEvent,
): Promise<Outcome> {
	const judge: Layer = { name: "judge", decide: (next) => runJudge(state, pi, ctx, next) };
	const decision = await decide(call, [...gateLayers(state), judge]);

	if (decision.action === "allow") return { action: "allow", by: decision.by };
	if (decision.action === "block")
		return { action: "block", by: decision.by, reason: decision.reason };

	if (!ctx.hasUI) {
		if (noUIMode(state.config, call.toolName) === "allow") return { action: "allow", by: "no UI" };
		return { action: "block", by: "no UI", reason: `${NAME}: no UI to approve "${call.toolName}"` };
	}

	if (isToolCallEventType("edit", event)) {
		const failure = await editFailure(ctx, event.input);
		if (failure) return { action: "block", by: "edit check", reason: failure };
	}

	await state.typing.waitUntilQuiet(ctx.signal, (waiting) => {
		ctx.ui.setStatus(NAME, waiting ? TYPING_STATUS : undefined);
	});

	state.typing.pause();
	const answer = await ask(ctx, call.toolName, call.target).finally(() => state.typing.resume());

	if (answer.decision === "deny") {
		return { action: "block", by: "you", reason: denyReason(answer.note), note: answer.note };
	}

	if (answer.remember) {
		const scope = answer.scope ?? "session";
		rememberAlwaysYes(pi, state, ctx, scope, call.toolName, answer.remember);
		ctx.ui.notify(
			`${NAME}: always yes for ${call.toolName} \u00b7 ${answer.remember} (${SCOPE_LABEL[scope]})`,
			"info",
		);
	}

	return { action: "allow", by: "you", note: answer.note };
}

async function runJudge(
	state: SessionState,
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	call: Call,
): Promise<Verdict | undefined> {
	if (Date.now() < state.judgeHealth.retryAt) return undefined;

	const outcome = await judgeGate({
		config: state.config,
		ctx,
		toolName: call.toolName,
		target: call.target,
		rawInput: call.input,
		cache: state.judgeCache,
		onStatus: (status) => ctx.ui.setStatus(JUDGE_STATUS, status),
	});
	if (!outcome) return undefined;

	const record = outcome.record;
	remember(record, state.judgeLog);
	appendJudgeEntry(pi, record);

	if (record.error) {
		warnOnce(ctx, state.judgeWarned, record);
		noteJudgeFailure(state, ctx);
	} else {
		resetJudgeHealth(state);
	}

	if (outcome.action === "deny") {
		return { action: "block", reason: `${NAME}: ${outcome.reason}` };
	}

	if (outcome.action === "allow") {
		if (state.config.judge.rememberApprovals) {
			const level = call.target.levels.at(-1);
			if (level !== undefined) rememberAlwaysYes(pi, state, ctx, "session", call.toolName, level);
		}
		return { action: "allow" };
	}

	if (state.config.judge.dryRun && !record.error) {
		ctx.ui.notify(`${NAME}: judge (dry run) ${judgeVerdictText(record)}`, "info");
	}

	return undefined;
}

async function ask(
	ctx: ExtensionContext,
	toolName: string,
	target: CallDescriptor,
): Promise<DialogAnswer> {
	if (ctx.mode === "tui") {
		try {
			const answer = await ctx.ui.custom<DialogAnswer>(
				(tui, theme, keybindings, done) =>
					new AskDialog({
						theme,
						toolName,
						target,
						keybindings,
						requestRender: () => tui.requestRender(),
						complete: done,
					}),
			);
			if (answer) return answer;
		} catch {
			// The plain selector, not an open gate.
		}
	}

	return askViaSelector(ctx, toolName, target);
}

function sendNote(pi: ExtensionAPI, note: string, toolName: string): void {
	void pi.sendMessage(
		{
			customType: NAME,
			content: noteBlock(note),
			display: true,
			details: { toolName },
		},
		{ deliverAs: "steer" },
	);
}

function noteBlock(note: string): string {
	return `[${NAME}] the user approved this call and added:\n${note}`;
}

function denyReason(note?: string): string {
	return note ? `${NAME}: denied by the user.\n${note}` : `${NAME}: denied by the user.`;
}
