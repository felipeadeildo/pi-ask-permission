/**
 * Judge orchestration: pick a backend, short-circuit the hard rules, run the
 * model, and hand the pipeline a final action. Backends never see the pipeline
 * and the pipeline never sees a network call.
 */
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";

import type { JudgeConfig } from "../core/config/schema.ts";
import { describe } from "../util/primitives.ts";
import { composeVerdict, judgeRisk, neverMatches } from "./compose.ts";
import { createJevBackend, type JudgeFetch } from "./jev.ts";
import { createPiBackend } from "./pi-model.ts";
import {
	JudgeError,
	type JudgeAction,
	type JudgeBackend,
	type JudgeInput,
	type JudgeOutcome,
	type JudgeRecord,
} from "./types.ts";

export * from "./types.ts";
export { judgeRisk, neverMatches } from "./compose.ts";
export { createJevBackend, TYPESAFE_BASE_URL, TYPESAFE_PROVIDER } from "./jev.ts";
export { createPiBackend, findModel } from "./pi-model.ts";
export {
	detectPolicyPreset,
	getPolicyPreset,
	MAX_POLICY_CHARS,
	POLICY_PRESETS,
	POLICY_TEMPLATE,
	type PolicyPreset,
	policyWarning,
} from "./policy.ts";
export { buildJudgeQuestions, buildJudgeState, describeInput } from "./state.ts";

export interface JudgeDeps {
	/** Resolved per call, so `/login` and runtime key changes take effect. */
	resolveApiKey: () => Promise<string | undefined>;
	modelRegistry: ModelRegistry;
	/** Overridden in tests; defaults to the global `fetch`. */
	fetchImpl?: JudgeFetch;
}

export function createJudgeBackend(config: JudgeConfig, deps: JudgeDeps): JudgeBackend {
	if (config.backend === "pi") {
		return createPiBackend({
			model: config.model,
			timeoutMs: config.timeoutMs,
			modelRegistry: deps.modelRegistry,
		});
	}

	return createJevBackend({
		model: config.model,
		timeoutMs: config.timeoutMs,
		resolveApiKey: deps.resolveApiKey,
		fetchImpl: deps.fetchImpl,
	});
}

export interface JudgeCallOptions {
	config: JudgeConfig;
	backend: JudgeBackend;
	input: JudgeInput;
	signal?: AbortSignal;
}

/**
 * Runs one judgement and resolves it against the config. Never throws for a
 * model or network problem: those become `onError`. A caller abort still
 * propagates so the rest of the pipeline can stop too.
 */
export async function judgeToolCall(options: JudgeCallOptions): Promise<JudgeOutcome> {
	const { config, backend, input } = options;

	const values = [input.target.summary, ...input.target.levels];
	if (neverMatches(config, values)) {
		const reason = "matches a never-auto-approve rule";
		return { action: "ask", reason, record: blankRecord(config, input, reason) };
	}

	const signal = options.signal ?? new AbortController().signal;

	let assessment: Awaited<ReturnType<JudgeBackend["assess"]>>;
	try {
		assessment = await backend.assess(input, signal);
	} catch (error) {
		if (options.signal?.aborted) throw error;

		const reason = `the judge could not decide: ${describe(error)}`;
		const wouldAct: JudgeAction = config.onError === "deny" ? "deny" : "ask";
		// Dry run never acts, even when onError would have.
		const dryRun = config.dryRun && wouldAct !== "ask";

		const record = blankRecord(config, input, reason);
		record.action = wouldAct;
		record.error = error instanceof JudgeError ? error.code : "error";
		record.dryRun = dryRun || undefined;
		return { action: dryRun ? "ask" : wouldAct, reason, record };
	}

	const composed = composeVerdict(config, assessment.answers);
	const risk = composed.risk ?? judgeRisk(assessment.answers);

	const wouldAct: JudgeAction =
		composed.decision === "uncertain" ? config.onUncertain : composed.decision;
	// Dry run keeps the human in the loop while still recording what the judge said.
	const dryRun = config.dryRun && wouldAct !== "ask";
	const action: JudgeAction = dryRun ? "ask" : wouldAct;
	const reason = dryRun ? `dry run: ${composed.reason}` : composed.reason;

	const record: JudgeRecord = {
		...assessment,
		at: Date.now(),
		toolName: input.toolName,
		summary: input.target.summary,
		risk,
		action: wouldAct,
		reason,
		dryRun: dryRun || undefined,
	};

	return { action, reason, record };
}

function blankRecord(config: JudgeConfig, input: JudgeInput, reason: string): JudgeRecord {
	return {
		backend: config.backend,
		model: config.model,
		answers: {},
		elapsedMs: 0,
		at: Date.now(),
		toolName: input.toolName,
		summary: input.target.summary,
		action: "ask",
		reason,
	};
}

/** A probe gets a generous window so it diagnoses a slow link instead of timing out like a real call. */
const PROBE_TIMEOUT_MS = 15_000;

export interface JudgeProbe {
	ok: boolean;
	detail: string;
	model?: string;
	elapsedMs: number;
}

/** Makes one real request, for `/perm judge test`. */
export async function probeJudge(
	config: JudgeConfig,
	deps: JudgeDeps,
	signal?: AbortSignal,
): Promise<JudgeProbe> {
	const started = Date.now();
	const backend = createJudgeBackend(
		{ ...config, timeoutMs: Math.max(config.timeoutMs, PROBE_TIMEOUT_MS) },
		deps,
	);

	try {
		const assessment = await backend.assess(
			probeInput(config),
			signal ?? new AbortController().signal,
		);
		return {
			ok: true,
			detail: "reachable",
			model: assessment.model,
			elapsedMs: Date.now() - started,
		};
	} catch (error) {
		return { ok: false, detail: describe(error), elapsedMs: Date.now() - started };
	}
}

function probeInput(config: JudgeConfig): JudgeInput {
	const command = "echo 'pi-ask-permission judge probe'";
	return {
		toolName: "bash",
		target: { summary: command, levels: ["echo", command] },
		rawInput: { command },
		cwd: process.cwd(),
		projectTrusted: true,
		lastUserMessage: "check that the judge is configured",
		policy: config.policy || "Connectivity probe from pi-ask-permission.",
		includeConversation: true,
	};
}
