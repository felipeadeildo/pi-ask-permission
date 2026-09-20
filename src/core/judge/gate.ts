import { createHash } from "node:crypto";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { isJudged } from "#core/config/patterns.ts";
import type { PermissionConfig } from "#core/config/schema.ts";
import { createJudgeBackend, judgeToolCall, TYPESAFE_PROVIDER } from "#core/judge/index.ts";
import type { JudgeInput, JudgeOutcome } from "#core/judge/types.ts";
import type { CallDescriptor } from "#core/target.ts";
import { isRecord } from "#util/primitives.ts";

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
		projectTrusted: ctx.isProjectTrusted(),
		lastUserMessage: config.judge.includeConversation ? lastUserMessage(ctx) : undefined,
		policy: config.judge.policy,
		includeConversation: config.judge.includeConversation,
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
	const request = input.lastUserMessage ?? "";
	const requestHash = createHash("sha1").update(request).digest("hex").slice(0, 16);

	return [
		config.judge.backend,
		config.judge.model,
		input.toolName,
		input.target.summary,
		input.target.grantLevels.join("\u0001"),
		requestHash,
	].join("\u0000");
}

function lastUserMessage(ctx: ExtensionContext): string | undefined {
	const entries = ctx.sessionManager.buildContextEntries();

	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index];
		if (entry?.type !== "message") continue;

		const message = entry.message as { role?: unknown; content?: unknown };
		if (message.role !== "user") continue;

		const text = contentText(message.content);
		if (text) return text;
	}

	return undefined;
}

function contentText(content: unknown): string | undefined {
	if (typeof content === "string") return content.trim() || undefined;
	if (!Array.isArray(content)) return undefined;

	const text = content
		.filter(
			(part): part is { type: string; text: string } =>
				isRecord(part) && part.type === "text" && typeof part.text === "string",
		)
		.map((part) => part.text)
		.join("\n")
		.trim();

	return text || undefined;
}
