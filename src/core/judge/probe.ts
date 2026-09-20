import { createJudgeBackend, type JudgeDeps } from "#core/judge/backends/factory.ts";
import type { JudgeConfig } from "#core/judge/config.ts";
import type { JudgeInput } from "#core/judge/types.ts";
import { describe } from "#util/primitives.ts";

const PROBE_TIMEOUT_MS = 15_000;

export interface JudgeProbe {
	ok: boolean;
	detail: string;
	model?: string;
	elapsedMs: number;
}

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
		target: { summary: command, grantLevels: ["echo", command] },
		rawInput: { command },
		cwd: process.cwd(),
		lastUserMessage: "check that the judge is configured",
		policy: config.policy || "Connectivity probe from pi-ask-permission.",
		includeConversation: true,
	};
}
