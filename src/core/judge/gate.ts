import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { isJudged } from "#core/config/patterns.ts";
import type { PermissionConfig } from "#core/config/schema.ts";
import { createJudgeBackend } from "#core/judge/backends/factory.ts";
import { TYPESAFE_PROVIDER } from "#core/judge/backends/jev.ts";
import { judgeToolCall } from "#core/judge/pipeline.ts";
import type { JudgeInput, JudgeOutcome } from "#core/judge/types.ts";
import type { CallDescriptor } from "#core/target.ts";

export interface JudgeGateOptions {
	config: PermissionConfig;
	ctx: ExtensionContext;
	toolName: string;
	target: CallDescriptor;
	rawInput: unknown;
	cache: Map<string, JudgeOutcome>;

	onStatus: (status: string | undefined) => void;
}

export async function judgeGate(options: JudgeGateOptions): Promise<JudgeOutcome | undefined> {
	const { config, ctx, toolName, target } = options;
	if (!isJudged(config, toolName)) return undefined;

	if (!ctx.hasUI && !config.judge.headless) return undefined;

	const input: JudgeInput = {
		toolName,
		target,
		rawInput: options.rawInput,
		cwd: ctx.cwd,
		policy: config.judge.policy,
	};

	const key = cacheKey(config, input);
	if (config.judge.cache) {
		const cached = options.cache.get(key);
		if (cached) return cached;
	}

	const backend = createJudgeBackend(config.judge, {
		resolveApiKey: () => ctx.modelRegistry.getApiKeyForProvider(TYPESAFE_PROVIDER),
		modelRegistry: ctx.modelRegistry,
	});

	options.onStatus(`judge: considering ${toolName}`);
	let outcome: JudgeOutcome;
	try {
		outcome = await judgeToolCall({ config: config.judge, backend, input, signal: ctx.signal });
	} finally {
		options.onStatus(undefined);
	}

	if (config.judge.cache && outcome.record && outcome.record.error === undefined) {
		options.cache.set(key, outcome);
	}

	return outcome;
}

function cacheKey(config: PermissionConfig, input: JudgeInput): string {
	return [
		config.judge.backend,
		config.judge.model,
		input.toolName,
		input.target.summary,
		input.target.grantLevels.join("\u0001"),
	].join("\u0000");
}
