import {
	type ExtensionAPI,
	type ExtensionContext,
	isToolCallEventType,
} from "@earendil-works/pi-coding-agent";

import { headlessMode, isAllowed } from "#core/config/patterns.ts";
import type { PermissionConfig } from "#core/config/schema.ts";
import type { PermissionDecision } from "#core/decision.ts";
import { grantKey, SCOPE_LABEL, type GrantScope } from "#core/grants.ts";
import { judgeGate } from "#core/judge/gate.ts";
import { judgeVerdictText, remember, warnOnce } from "#core/judge/report.ts";
import { isReadOnlyCommand } from "#core/readonly-bash.ts";
import type { CallDescriptor } from "#core/target.ts";
import { deriveTarget } from "#core/target.ts";
import { NAME } from "#identity";
import { editFailure } from "#pi/preflight.ts";
import { isGranted, loadGrantScopes, persistGrants, type SessionState } from "#pi/session.ts";
import { AskDialog } from "#ui/dialog.ts";
import { appendJudgeEntry, judgeEntryWorthShowing } from "#ui/judge-entry.ts";
import { askViaSelector } from "#ui/selector.ts";

const JUDGE_STATUS = `${NAME}:judge`;
const TYPING_STATUS = "waiting for you to finish typing";
const JUDGE_FAILURE_LIMIT = 2;
const JUDGE_RETRY_MS = 60_000;

export function registerEvents(pi: ExtensionAPI, state: SessionState): void {
	pi.on("session_start", (_event, ctx) => {
		for (const warning of state.configWarnings) ctx.ui.notify(`${NAME}: ${warning}`, "warning");
		loadGrantScopes(state, ctx);
		state.typing.start(ctx);
	});

	pi.on("session_shutdown", () => {
		state.typing.stop();
	});

	pi.on("tool_call", async (event, ctx) => {
		const { config } = state;
		if (config.yolo) return undefined;

		const toolName = event.toolName;
		if (isAllowed(config, toolName)) return undefined;

		const target = deriveTarget(toolName, event.input);
		if (isGranted(state, toolName, target.grantLevels)) return undefined;

		if (
			config.readOnlyBash &&
			isToolCallEventType("bash", event) &&
			isReadOnlyCommand(event.input.command)
		) {
			return undefined;
		}

		const resolution = await runJudge(pi, state, {
			ctx,
			toolName,
			target,
			rawInput: event.input,
		});
		if (resolution?.block) return resolution.block;
		if (resolution?.allow) return undefined;

		if (!ctx.hasUI) return headlessRefusal(config, toolName);

		if (isToolCallEventType("edit", event)) {
			const failure = await editFailure(ctx, event.input);
			if (failure) return { block: true, reason: failure };
		}

		await state.typing.waitUntilQuiet(ctx.signal, (waiting) => {
			ctx.ui.setStatus(NAME, waiting ? TYPING_STATUS : undefined);
		});

		state.typing.pause();
		const decision = await ask(ctx, toolName, target).finally(() => state.typing.resume());

		if (decision.decision === "deny") {
			return { block: true, reason: denyReason(decision.note) };
		}

		if (decision.remember) {
			const scope: GrantScope = decision.scope ?? "session";
			state.grants[scope].add(grantKey(toolName, decision.remember));
			if (scope !== "session") persistGrants(state, ctx, scope);

			ctx.ui.notify(
				`${NAME}: always yes for ${toolName} \u00b7 ${decision.remember} (${SCOPE_LABEL[scope]})`,
				"info",
			);
		}

		if (decision.note) {
			if (config.followup === "message") sendNote(pi, decision.note, toolName);
			else state.pendingNotes.set(event.toolCallId, decision.note);
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

interface JudgeRequest {
	ctx: ExtensionContext;
	toolName: string;
	target: CallDescriptor;
	rawInput: unknown;
}

interface JudgeResolution {
	block?: { block: true; reason: string };
	allow?: boolean;
}

async function runJudge(
	pi: ExtensionAPI,
	state: SessionState,
	request: JudgeRequest,
): Promise<JudgeResolution | undefined> {
	const { ctx, toolName, target } = request;
	if (Date.now() < state.judgeHealth.retryAt) return undefined;

	const outcome = await judgeGate({
		config: state.config,
		ctx,
		toolName,
		target,
		rawInput: request.rawInput,
		cache: state.judgeCache,
		onStatus: (status) => ctx.ui.setStatus(JUDGE_STATUS, status),
	});
	if (!outcome || !outcome.record) return undefined;

	const record = outcome.record;
	remember(record, state.judgeLog);
	if (judgeEntryWorthShowing(record)) appendJudgeEntry(pi, record);

	if (record.error) {
		warnOnce(ctx, state.judgeWarned, record);
		state.judgeHealth.failures++;
		if (state.judgeHealth.failures >= JUDGE_FAILURE_LIMIT) {
			state.judgeHealth.failures = 0;
			state.judgeHealth.retryAt = Date.now() + JUDGE_RETRY_MS;
			ctx.ui.notify(
				`${NAME}: judge paused for ${JUDGE_RETRY_MS / 1000}s after repeated failures; run /perm judge test`,
				"warning",
			);
		}
	} else {
		state.judgeHealth.failures = 0;
		state.judgeHealth.retryAt = 0;
	}

	if (outcome.action === "deny") {
		return { block: { block: true, reason: `${NAME}: ${outcome.reason}` } };
	}

	if (outcome.action === "allow") {
		if (state.config.judge.grant) {
			const level = target.grantLevels.at(-1);
			if (level !== undefined) state.grants.session.add(grantKey(toolName, level));
		}
		return { allow: true };
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
): Promise<PermissionDecision> {
	if (ctx.mode === "tui") {
		try {
			const decision = await ctx.ui.custom<PermissionDecision>(
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
			if (decision) return decision;
		} catch {
			// Fall through to the plain selector rather than failing the call open.
		}
	}

	return askViaSelector(ctx, toolName, target);
}

function headlessRefusal(
	config: PermissionConfig,
	toolName: string,
): { block: true; reason: string } | undefined {
	if (headlessMode(config, toolName) === "allow") return undefined;
	return { block: true, reason: `${NAME}: no UI available to approve "${toolName}"` };
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
