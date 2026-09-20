import type { ModelRegistry } from "@earendil-works/pi-coding-agent";

import type { JudgeConfig } from "#core/config/schema.ts";
import { createJevBackend, type JudgeFetch } from "#core/judge/backends/jev.ts";
import { createPiBackend } from "#core/judge/backends/pi-model.ts";
import type { JudgeBackend } from "#core/judge/types.ts";

export interface JudgeDeps {
	resolveApiKey: () => Promise<string | undefined>;
	modelRegistry: ModelRegistry;
	/** Tests inject one; production uses the global `fetch`. */
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
