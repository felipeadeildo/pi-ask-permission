/**
 * pi-ask-permission: every tool call not on the allowlist stops and asks yes /
 * always yes / deny, each with an optional note. When AI approvals are on, a
 * judge model gets first refusal and uncertain calls fall through to the dialog.
 *
 * Config: <agentDir>/extensions/pi-ask-permission/config.json
 * Commands: /perm, /perm status, /perm judge [log|on|off], /perm reset [scope]
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CONFIG_DIR_NAME, isToolCallEventType } from "@earendil-works/pi-coding-agent";

import { registerBashTimer } from "./bash-timer.ts";
import { headlessMode, isAllowed } from "./core/config/patterns.ts";
import type { PermissionConfig } from "./core/config/schema.ts";
import { grantsPath, loadConfig, projectGrantsPath, saveConfig } from "./core/config/store.ts";
import { AskDialog } from "./dialog.ts";
import {
	type GrantScope,
	GRANT_SCOPES,
	SCOPE_LABEL,
	deleteGrants,
	grantKey,
	grantsFileExists,
	loadGrants,
	saveGrants,
} from "./grants.ts";
import { NAME } from "./identity.ts";
import { appendJudgeEntry, judgeEntryWorthShowing, registerJudgeEntry } from "./judge/entry.ts";
import { judgeGate } from "./judge/gate.ts";
import {
	type JudgeOutcome,
	type JudgeRecord,
	probeJudge,
	TYPESAFE_BASE_URL,
	TYPESAFE_PROVIDER,
} from "./judge/index.ts";
import { judgeLogText, judgeVerdictText, remember, warnOnce } from "./judge/report.ts";
import type { AskDecision } from "./options.ts";
import { editFailure } from "./preflight.ts";
import { isReadOnlyCommand } from "./readonly.ts";
import { askViaSelector } from "./selector.ts";
import { grantCount, openSettings, statusText } from "./settings.ts";
import { type CallTarget, deriveTarget } from "./targets.ts";
import { TypingMonitor } from "./typing.ts";

const JUDGE_STATUS = `${NAME}:judge`;
const TYPING_STATUS = "waiting for you to finish typing";
/** Consecutive judge failures before the judge pauses for a cooldown. */
const JUDGE_FAILURE_LIMIT = 2;
const JUDGE_RETRY_MS = 60_000;

type PersistedScope = Exclude<GrantScope, "session">;

function grantPath(scope: PersistedScope, cwd: string): string {
	return scope === "global" ? grantsPath() : projectGrantsPath(cwd, CONFIG_DIR_NAME);
}

export default function piAskPermission(pi: ExtensionAPI) {
	registerBashTimer(pi);
	registerTypesafeProvider(pi);
	registerJudgeEntry(pi);

	const loaded = loadConfig();
	const config = loaded.config;

	/** Grants by scope. Session is memory only; the other two mirror their file. */
	const grants: Record<GrantScope, Set<string>> = {
		session: new Set(),
		project: new Set(),
		global: new Set(),
	};
	/** Approval notes waiting for their tool result, keyed by tool call id. */
	const pendingNotes = new Map<string, string>();
	/** Judge verdicts reused for identical calls, and the session audit trail. */
	const judgeCache = new Map<string, JudgeOutcome>();
	const judgeLog: JudgeRecord[] = [];
	const judgeWarned = new Set<string>();
	/** Trips after repeated failures so a blocked network does not stall every call. */
	const judgeHealth: JudgeHealth = { failures: 0, retryAt: 0 };

	const typing = new TypingMonitor(config.typing.pause, config.typing.maxWait);

	const isGranted = (toolName: string, levels: string[]): boolean =>
		levels.some((level) => {
			const key = grantKey(toolName, level);
			return grants.session.has(key) || grants.project.has(key) || grants.global.has(key);
		});

	const save = (ctx: ExtensionContext): void => {
		const error = saveConfig(config);
		if (error) ctx.ui.notify(`${NAME}: could not save config: ${error}`, "error");
	};

	const openSettingsFor = (ctx: ExtensionContext): Promise<void> =>
		openSettings(ctx, {
			config,
			grants,
			save: () => save(ctx),
			onJudgeChange: () => judgeCache.clear(),
		});

	const persist = (ctx: ExtensionContext, scope: PersistedScope): void => {
		const error = saveGrants(grantPath(scope, ctx.cwd), grants[scope]);
		if (error) ctx.ui.notify(`${NAME}: could not save grants: ${error}`, "error");
	};

	const forget = (ctx: ExtensionContext, scope: GrantScope | "all"): number => {
		const targets = scope === "all" ? GRANT_SCOPES : [scope];
		let removed = 0;

		for (const target of targets) {
			removed += grants[target].size;
			grants[target].clear();
			if (target === "session") continue;

			const error = deleteGrants(grantPath(target, ctx.cwd));
			if (error) ctx.ui.notify(`${NAME}: could not delete grants: ${error}`, "error");
		}

		return removed;
	};

	/**
	 * Reloads the two persisted scopes. The project file is read only for a
	 * trusted project, so a repository cannot widen its own permissions.
	 */
	const loadScopes = (ctx: ExtensionContext): void => {
		grants.session.clear();
		grants.global = loadScope(ctx, grantsPath());

		const projectFile = projectGrantsPath(ctx.cwd, CONFIG_DIR_NAME);
		if (ctx.isProjectTrusted()) {
			grants.project = loadScope(ctx, projectFile);
			return;
		}

		grants.project = new Set();
		if (grantsFileExists(projectFile)) {
			ctx.ui.notify(`${NAME}: ${projectFile} skipped, this project is not trusted`, "warning");
		}
	};

	pi.on("session_start", (_event, ctx) => {
		for (const warning of loaded.warnings) ctx.ui.notify(`${NAME}: ${warning}`, "warning");
		loadScopes(ctx);
		typing.start(ctx);
	});

	pi.on("session_shutdown", () => {
		typing.stop();
	});

	pi.on("tool_call", async (event, ctx) => {
		if (config.yolo) return undefined;

		const toolName = event.toolName;
		if (isAllowed(config, toolName)) return undefined;

		const target = deriveTarget(toolName, event.input);
		if (isGranted(toolName, target.levels)) return undefined;

		// Reading is already allowed through `allow` for the file tools, so a bash
		// command that only reads can skip the dialog too.
		if (
			config.readOnlyBash &&
			isToolCallEventType("bash", event) &&
			isReadOnlyCommand(event.input.command)
		) {
			return undefined;
		}

		const resolution = await runJudge({
			pi,
			config,
			ctx,
			toolName,
			target,
			rawInput: event.input,
			cache: judgeCache,
			log: judgeLog,
			warned: judgeWarned,
			health: judgeHealth,
			grants,
		});
		if (resolution?.block) return resolution.block;
		if (resolution?.allow) return undefined;

		if (!ctx.hasUI) return headlessRefusal(config, toolName);

		// An edit that cannot apply fails either way, so block it instead of asking.
		if (isToolCallEventType("edit", event)) {
			const failure = await editFailure(ctx, event.input);
			if (failure) return { block: true, reason: failure };
		}

		await typing.waitUntilQuiet(ctx.signal, (waiting) => {
			ctx.ui.setStatus(NAME, waiting ? TYPING_STATUS : undefined);
		});

		typing.pause();
		const decision = await ask(ctx, toolName, target).finally(() => typing.resume());

		if (decision.decision === "deny") {
			return { block: true, reason: denyReason(decision.note) };
		}

		if (decision.remember) {
			const scope = decision.scope ?? "session";
			grants[scope].add(grantKey(toolName, decision.remember));
			if (scope !== "session") persist(ctx, scope);

			const where = SCOPE_LABEL[scope];
			ctx.ui.notify(
				`${NAME}: always yes for ${toolName} \u00b7 ${decision.remember} (${where})`,
				"info",
			);
		}

		if (decision.note) {
			if (config.followup === "message") sendNote(pi, decision.note, toolName);
			else pendingNotes.set(event.toolCallId, decision.note);
		}

		return undefined;
	});

	// "result" appends the note to the tool output the model already reads.
	pi.on("tool_result", (event) => {
		const note = pendingNotes.get(event.toolCallId);
		if (!note) return undefined;

		pendingNotes.delete(event.toolCallId);
		return { content: [...event.content, { type: "text", text: noteBlock(note) }] };
	});

	pi.registerCommand("perm", {
		description: `${NAME}: settings, status, reset`,
		handler: async (args, ctx) => {
			const [verb, argument] = args.trim().toLowerCase().split(/\s+/);

			if (verb === "judge") {
				await judgeCommand(ctx, argument);
				return;
			}

			if (verb === "reset") {
				const target = argument ?? "session";
				if (!isResetTarget(target)) {
					ctx.ui.notify(`${NAME}: reset takes session, project, global, or all`, "warning");
					return;
				}

				const where = target === "all" ? "every scope" : SCOPE_LABEL[target];
				ctx.ui.notify(`${NAME}: forgot ${grantCount(forget(ctx, target))} from ${where}`, "info");
				return;
			}

			if (verb === "status" || ctx.mode !== "tui") {
				ctx.ui.notify(statusText(config, grants, loaded.path, ctx.cwd), "info");
				return;
			}

			await openSettingsFor(ctx);
		},
	});

	async function judgeCommand(ctx: ExtensionContext, argument: string | undefined): Promise<void> {
		if (argument === "log") {
			ctx.ui.notify(judgeLogText(judgeLog), "info");
			return;
		}

		if (argument === "test") {
			await runJudgeProbe(ctx);
			return;
		}

		if (argument === "on" || argument === "off") {
			config.judge.enabled = argument === "on";
			save(ctx);
			judgeCache.clear();
			if (argument === "on") {
				judgeHealth.failures = 0;
				judgeHealth.retryAt = 0;
			}
			ctx.ui.notify(`${NAME}: AI approvals ${argument}`, "info");
			return;
		}

		if (argument === "status" || ctx.mode !== "tui") {
			ctx.ui.notify(statusText(config, grants, loaded.path, ctx.cwd), "info");
			return;
		}

		await openSettingsFor(ctx);
	}

	async function runJudgeProbe(ctx: ExtensionContext): Promise<void> {
		ctx.ui.setStatus(JUDGE_STATUS, "judge: testing\u2026");
		const auth = ctx.modelRegistry.getProviderAuthStatus(TYPESAFE_PROVIDER);
		const probe = await probeJudge(
			config.judge,
			{
				resolveApiKey: () => ctx.modelRegistry.getApiKeyForProvider(TYPESAFE_PROVIDER),
				modelRegistry: ctx.modelRegistry,
			},
			ctx.signal,
		).finally(() => ctx.ui.setStatus(JUDGE_STATUS, undefined));

		if (!probe.ok) {
			const source = auth.configured
				? `key from ${auth.label ?? auth.source}`
				: "no key configured";
			ctx.ui.notify(
				`${NAME}: judge test failed \u2014 ${probe.detail}${
					config.judge.backend === "jev" ? ` (${source})` : ""
				}`,
				"error",
			);
			return;
		}

		judgeHealth.failures = 0;
		judgeHealth.retryAt = 0;

		const summary = `judge test ok \u00b7 ${probe.model ?? config.judge.model} \u00b7 ${probe.elapsedMs}ms`;
		if (probe.elapsedMs > config.judge.timeoutMs) {
			ctx.ui.notify(
				`${NAME}: ${summary} \u2014 slower than the ${config.judge.timeoutMs}ms timeout, raise judge.timeoutMs`,
				"warning",
			);
			return;
		}

		ctx.ui.notify(`${NAME}: ${summary}`, "info");
	}
}

function registerTypesafeProvider(pi: ExtensionAPI): void {
	// Auth-only provider: `/login typesafe` and `$TYPESAFE_API_KEY` both work, and
	// with no models it never appears in the model picker.
	pi.registerProvider(TYPESAFE_PROVIDER, {
		name: "TypeSafe (Jev)",
		baseUrl: TYPESAFE_BASE_URL,
		apiKey: "$TYPESAFE_API_KEY",
	});
}

interface RunJudgeOptions {
	pi: ExtensionAPI;
	config: PermissionConfig;
	ctx: ExtensionContext;
	toolName: string;
	target: CallTarget;
	rawInput: unknown;
	cache: Map<string, JudgeOutcome>;
	log: JudgeRecord[];
	warned: Set<string>;
	health: JudgeHealth;
	grants: Record<GrantScope, Set<string>>;
}

interface JudgeHealth {
	failures: number;
	/** Epoch ms before which the judge stays paused. */
	retryAt: number;
}

interface JudgeResolution {
	block?: { block: true; reason: string };
	allow?: boolean;
}

async function runJudge(options: RunJudgeOptions): Promise<JudgeResolution | undefined> {
	const { config, ctx, toolName, target } = options;
	if (Date.now() < options.health.retryAt) return undefined;

	const outcome = await judgeGate({
		config,
		ctx,
		toolName,
		target,
		rawInput: options.rawInput,
		cache: options.cache,
		onStatus: (status) => ctx.ui.setStatus(JUDGE_STATUS, status),
	});
	if (!outcome) return undefined;

	remember(outcome.record, options.log);
	if (outcome.record && judgeEntryWorthShowing(outcome.record)) {
		appendJudgeEntry(options.pi, outcome.record);
	}

	if (outcome.record?.error) {
		warnOnce(ctx, options.warned, outcome.record);
		options.health.failures++;
		if (options.health.failures >= JUDGE_FAILURE_LIMIT) {
			options.health.failures = 0;
			options.health.retryAt = Date.now() + JUDGE_RETRY_MS;
			ctx.ui.notify(
				`${NAME}: judge paused for ${JUDGE_RETRY_MS / 1000}s after repeated failures; run /perm judge test`,
				"warning",
			);
		}
	} else {
		options.health.failures = 0;
		options.health.retryAt = 0;
	}

	if (outcome.action === "deny") {
		return { block: { block: true, reason: `${NAME}: ${outcome.reason}` } };
	}

	if (outcome.action === "allow") {
		if (config.judge.grant) {
			const level = target.levels.at(-1);
			if (level !== undefined) options.grants.session.add(grantKey(toolName, level));
		}
		return { allow: true };
	}

	// Dry run: the dialog is about to open, so say what the judge would have done.
	if (config.judge.dryRun && outcome.record && !outcome.record.error) {
		ctx.ui.notify(`${NAME}: judge (dry run) ${judgeVerdictText(outcome.record)}`, "info");
	}

	return undefined;
}

async function ask(
	ctx: ExtensionContext,
	toolName: string,
	target: CallTarget,
): Promise<AskDecision> {
	if (ctx.mode === "tui") {
		try {
			const decision = await ctx.ui.custom<AskDecision>(
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

function isGrantScope(value: string): value is GrantScope {
	return GRANT_SCOPES.some((scope) => scope === value);
}

function isResetTarget(value: string): value is GrantScope | "all" {
	return value === "all" || isGrantScope(value);
}

function loadScope(ctx: ExtensionContext, path: string): Set<string> {
	const loaded = loadGrants(path);
	if (loaded.warning) ctx.ui.notify(`${NAME}: ${loaded.warning}`, "warning");
	return loaded.grants;
}
