import { describe, expect, test } from "bun:test";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
	DEFAULT_CONFIG,
	defaultJudge,
	type JudgeConfig,
	type PermissionConfig,
} from "#core/config/schema.ts";
import { composeVerdict, judgeRisk, neverMatches, RISK_WEIGHTS } from "#core/judge/compose.ts";
import { judgeGate } from "#core/judge/gate.ts";
import { judgeToolCall, probeJudge } from "#core/judge/index.ts";
import { createJevBackend, parseJevResponse, toAnswers } from "#core/judge/jev.ts";
import { parseJudgeJson, toAnswersFromJson } from "#core/judge/pi-model.ts";
import {
	detectPolicyPreset,
	POLICY_PRESETS,
	POLICY_TEMPLATE,
	policyWarning,
} from "#core/judge/policy.ts";
import { judgeLogText, judgeSignalText, judgeVerdictText } from "#core/judge/report.ts";
import { buildJudgeQuestions, buildJudgeState } from "#core/judge/state.ts";
import {
	JudgeError,
	type JudgeAnswers,
	type JudgeAssessment,
	type JudgeBackend,
	type JudgeInput,
	type JudgeRecord,
} from "#core/judge/types.ts";

function answers(overrides: Partial<JudgeAnswers> = {}): JudgeAnswers {
	return {
		verdict: { choice: "allow", confidence: 0.95 },
		intent_match: 0.9,
		reversibility: 0.2,
		sensitive_access: 0.05,
		outside_workspace: 0.1,
		...overrides,
	};
}

function judgeInput(overrides: Partial<JudgeInput> = {}): JudgeInput {
	return {
		toolName: "bash",
		target: { summary: "pnpm test", levels: ["pnpm", "pnpm test"] },
		rawInput: { command: "pnpm test" },
		cwd: "/repo",
		projectTrusted: true,
		lastUserMessage: "run the tests",
		policy: "allow tests",
		includeConversation: true,
		...overrides,
	};
}

function stubBackend(assessment: JudgeAssessment): JudgeBackend {
	return { id: assessment.backend, assess: async () => assessment };
}

describe("composeVerdict", () => {
	test("approves a confident, low-risk call", () => {
		const result = composeVerdict(defaultJudge(), answers());
		expect(result.decision).toBe("allow");
		expect(result.risk).toBeCloseTo(0.45 * 0.1 + 0.3 * 0.05 + 0.25 * 0.1, 5);
	});

	test("denies a confident denial", () => {
		const result = composeVerdict(
			defaultJudge(),
			answers({ verdict: { choice: "deny", confidence: 0.95 } }),
		);
		expect(result.decision).toBe("deny");
	});

	test("defers a timid denial", () => {
		const result = composeVerdict(
			defaultJudge(),
			answers({ verdict: { choice: "deny", confidence: 0.4 } }),
		);
		expect(result.decision).toBe("uncertain");
	});

	test("never auto-denies when autoDeny is off", () => {
		const config = { ...defaultJudge(), autoDeny: false };
		const result = composeVerdict(config, answers({ verdict: { choice: "deny", confidence: 1 } }));
		expect(result.decision).toBe("uncertain");
	});

	test("defers when risk is above the ceiling", () => {
		const config = { ...defaultJudge(), riskCeiling: 0.05 };
		expect(composeVerdict(config, answers()).decision).toBe("uncertain");
	});

	test("defers when intent is below the floor", () => {
		const result = composeVerdict(defaultJudge(), answers({ intent_match: 0.1 }));
		expect(result.decision).toBe("uncertain");
	});

	test("defers when a signal is missing", () => {
		const result = composeVerdict(defaultJudge(), answers({ reversibility: undefined }));
		expect(result.decision).toBe("uncertain");
		expect(result.risk).toBeUndefined();
	});

	test("a needs_human verdict always defers", () => {
		const result = composeVerdict(
			defaultJudge(),
			answers({ verdict: { choice: "needs_human", confidence: 1 } }),
		);
		expect(result.decision).toBe("uncertain");
	});
});

describe("judgeRisk", () => {
	test("weights each signal", () => {
		expect(judgeRisk({ reversibility: 2, sensitive_access: 1, outside_workspace: 1 })).toBeCloseTo(
			RISK_WEIGHTS.reversibility + RISK_WEIGHTS.sensitive + RISK_WEIGHTS.outside,
			5,
		);
	});

	test("is undefined with a missing signal", () => {
		expect(judgeRisk({ reversibility: 2 })).toBeUndefined();
	});
});

describe("neverMatches", () => {
	test("matches the summary or any level", () => {
		const config = { ...defaultJudge(), never: ["rm -rf*"] };
		expect(neverMatches(config, ["rm -rf /", "rm"])).toBe(true);
		expect(neverMatches(config, ["pnpm test"])).toBe(false);
	});
});

describe("buildJudgeState", () => {
	test("carries policy, call, project, and the request", () => {
		const state = buildJudgeState(judgeInput());
		expect(state.policy).toBe("allow tests");
		expect(state.request).toEqual({ last_user_message: "run the tests" });
		expect((state.call as Record<string, unknown>).tool).toBe("bash");
		expect((state.project as Record<string, unknown>).name).toBe("repo");
	});

	test("omits the request when conversation is off", () => {
		const state = buildJudgeState(judgeInput({ includeConversation: false }));
		expect(state.request).toBeUndefined();
	});

	test("caps an oversized input", () => {
		const state = buildJudgeState(judgeInput({ rawInput: "x".repeat(20_000) }));
		const input = (state.call as Record<string, unknown>).input as string;
		expect(input.length).toBeLessThan(20_000);
		expect(input.endsWith("...")).toBe(true);
	});
});

describe("buildJudgeQuestions", () => {
	test("asks the fixed battery", () => {
		const questions = buildJudgeQuestions(judgeInput());
		expect(Object.keys(questions)).toEqual([
			"verdict",
			"intent_match",
			"reversibility",
			"sensitive_access",
			"outside_workspace",
		]);
	});

	test("looks at the request only when there is one", () => {
		const withRequest = buildJudgeQuestions(judgeInput());
		const without = buildJudgeQuestions(judgeInput({ includeConversation: false }));
		expect(JSON.stringify(withRequest.intent_match)).toContain("request.last_user_message");
		expect(JSON.stringify(without.intent_match)).not.toContain("request.last_user_message");
	});
});

describe("policy", () => {
	test("detects a preset and calls hand-written text custom", () => {
		const standard = POLICY_PRESETS.find((preset) => preset.id === "standard");
		expect(detectPolicyPreset(standard?.policy ?? "")).toBe("standard");
		expect(detectPolicyPreset("my own rules")).toBe("custom");
	});

	test("warns on an empty or oversized policy", () => {
		expect(policyWarning("")).toContain("no policy");
		expect(policyWarning("x".repeat(9000))).toContain("characters");
		expect(policyWarning(POLICY_TEMPLATE)).toBeUndefined();
	});
});

describe("parseJevResponse", () => {
	test("reads typed answers and the versioned model", () => {
		const parsed = parseJevResponse(
			{
				model: "jev-1.13.0",
				answers: {
					verdict: { type: "choice", choice: "allow", confidence: 0.9 },
					intent_match: { type: "noul", noul: 0.8 },
					reversibility: { type: "score", score: 1.5 },
					sensitive_access: { type: "noul", noul: 0.1 },
					outside_workspace: { type: "noul", noul: 0.2 },
				},
				usage: { input_tokens: 300, output_tokens: 12 },
			},
			"jev-latest",
		);

		expect(parsed.model).toBe("jev-1.13.0");
		expect(parsed.answers.verdict).toEqual({ choice: "allow", confidence: 0.9 });
		expect(parsed.answers.reversibility).toBe(1.5);
		expect(parsed.usage).toEqual({ input: 300, output: 12 });
	});

	test("rejects a body without answers", () => {
		expect(() => parseJevResponse({ model: "jev" }, "jev-latest")).toThrow(JudgeError);
	});

	test("ignores an unknown choice", () => {
		expect(toAnswers({ verdict: { choice: "maybe", confidence: 1 } }).verdict).toBeUndefined();
	});
});

describe("createJevBackend", () => {
	test("asks for a key when none is stored", async () => {
		const backend = createJevBackend({
			model: "jev-latest",
			timeoutMs: 1000,
			resolveApiKey: async () => undefined,
		});
		await expect(backend.assess(judgeInput(), new AbortController().signal)).rejects.toMatchObject({
			code: "no-api-key",
		});
	});

	test("returns an assessment on success", async () => {
		const backend = createJevBackend({
			model: "jev-latest",
			timeoutMs: 1000,
			resolveApiKey: async () => "key",
			fetchImpl: async () =>
				Response.json({
					model: "jev-1.13.0",
					answers: { verdict: { choice: "allow", confidence: 0.9 } },
				}),
		});

		const assessment = await backend.assess(judgeInput(), new AbortController().signal);
		expect(assessment.backend).toBe("jev");
		expect(assessment.model).toBe("jev-1.13.0");
		expect(assessment.answers.verdict?.choice).toBe("allow");
	});

	test("retries a 429 after the retry-after delay", async () => {
		let calls = 0;
		const backend = createJevBackend({
			model: "jev-latest",
			timeoutMs: 1000,
			resolveApiKey: async () => "key",
			fetchImpl: async () => {
				calls++;
				if (calls === 1) {
					return new Response("slow down", {
						status: 429,
						headers: { "retry-after": "0" },
					});
				}
				return Response.json({ model: "jev-1.13.0", answers: {} });
			},
		});

		await backend.assess(judgeInput(), new AbortController().signal);
		expect(calls).toBe(2);
	});

	test("a rate limit it cannot outlast is reported as 429, not a timeout", async () => {
		const backend = createJevBackend({
			model: "jev-latest",
			timeoutMs: 100,
			resolveApiKey: async () => "key",
			fetchImpl: async () =>
				new Response("slow down", { status: 429, headers: { "retry-after": "5" } }),
		});

		await expect(backend.assess(judgeInput(), new AbortController().signal)).rejects.toMatchObject({
			code: "http-429",
		});
	});

	test("reports an HTTP failure", async () => {
		const backend = createJevBackend({
			model: "jev-latest",
			timeoutMs: 1000,
			resolveApiKey: async () => "key",
			fetchImpl: async () => new Response("nope", { status: 401 }),
		});
		await expect(backend.assess(judgeInput(), new AbortController().signal)).rejects.toMatchObject({
			code: "http-401",
		});
	});

	test("times out", async () => {
		const backend = createJevBackend({
			model: "jev-latest",
			timeoutMs: 5,
			resolveApiKey: async () => "key",
			fetchImpl: (_url, init) =>
				new Promise((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
				}),
		});
		await expect(backend.assess(judgeInput(), new AbortController().signal)).rejects.toMatchObject({
			code: "timeout",
		});
	});
});

describe("judgeToolCall", () => {
	test("short-circuits a never rule without calling the backend", async () => {
		let called = false;
		const backend: JudgeBackend = {
			id: "jev",
			assess: async () => {
				called = true;
				return { backend: "jev", model: "jev", answers: {}, elapsedMs: 0 };
			},
		};

		const config = { ...defaultJudge(), never: ["rm -rf*"] };
		const outcome = await judgeToolCall({
			config,
			backend,
			input: judgeInput({ target: { summary: "rm -rf /", levels: ["rm", "rm -rf /"] } }),
		});

		expect(called).toBe(false);
		expect(outcome.action).toBe("ask");
		expect(outcome.record).toBeDefined();
	});

	test("allows, denies, and escalates by verdict", async () => {
		const allow = await judgeToolCall({
			config: defaultJudge(),
			backend: stubBackend({ backend: "jev", model: "jev", answers: answers(), elapsedMs: 1 }),
			input: judgeInput(),
		});
		expect(allow.action).toBe("allow");

		const deny = await judgeToolCall({
			config: defaultJudge(),
			backend: stubBackend({
				backend: "jev",
				model: "jev",
				answers: answers({ verdict: { choice: "deny", confidence: 0.99 } }),
				elapsedMs: 1,
			}),
			input: judgeInput(),
		});
		expect(deny.action).toBe("deny");

		const unsure = await judgeToolCall({
			config: defaultJudge(),
			backend: stubBackend({
				backend: "jev",
				model: "jev",
				answers: answers({ verdict: { choice: "needs_human", confidence: 1 } }),
				elapsedMs: 1,
			}),
			input: judgeInput(),
		});
		expect(unsure.action).toBe("ask");
	});

	test("a dry run records the verdict but still asks", async () => {
		const config = { ...defaultJudge(), dryRun: true };
		const outcome = await judgeToolCall({
			config,
			backend: stubBackend({ backend: "jev", model: "jev", answers: answers(), elapsedMs: 1 }),
			input: judgeInput(),
		});

		expect(outcome.action).toBe("ask");
		expect(outcome.record?.action).toBe("allow");
		expect(outcome.record?.dryRun).toBe(true);
	});

	test("uses onError when the backend fails", async () => {
		const backend: JudgeBackend = {
			id: "jev",
			assess: async () => {
				throw new JudgeError("boom", "network");
			},
		};

		const ask = await judgeToolCall({ config: defaultJudge(), backend, input: judgeInput() });
		expect(ask.action).toBe("ask");
		expect(ask.record?.error).toBe("network");

		const deny = await judgeToolCall({
			config: { ...defaultJudge(), onError: "deny" },
			backend,
			input: judgeInput(),
		});
		expect(deny.action).toBe("deny");
	});

	test("a dry run never acts, even on error", async () => {
		const backend: JudgeBackend = {
			id: "jev",
			assess: async () => {
				throw new JudgeError("boom", "network");
			},
		};

		const outcome = await judgeToolCall({
			config: { ...defaultJudge(), dryRun: true, onError: "deny" },
			backend,
			input: judgeInput(),
		});

		expect(outcome.action).toBe("ask");
		expect(outcome.record?.action).toBe("deny");
		expect(outcome.record?.dryRun).toBe(true);
	});

	test("honors onUncertain", async () => {
		const backend = stubBackend({
			backend: "jev",
			model: "jev",
			answers: answers({ verdict: { choice: "needs_human", confidence: 1 } }),
			elapsedMs: 1,
		});

		const allow = await judgeToolCall({
			config: { ...defaultJudge(), onUncertain: "allow" },
			backend,
			input: judgeInput(),
		});
		expect(allow.action).toBe("allow");
	});

	test("propagates a caller abort instead of falling back", async () => {
		const controller = new AbortController();
		const backend: JudgeBackend = {
			id: "jev",
			assess: async () => {
				controller.abort();
				throw new Error("aborted");
			},
		};

		await expect(
			judgeToolCall({
				config: defaultJudge(),
				backend,
				input: judgeInput(),
				signal: controller.signal,
			}),
		).rejects.toThrow("aborted");
	});
});

describe("probeJudge", () => {
	const deps = { resolveApiKey: async () => "key", modelRegistry: {} as never };

	test("reports a reachable judge with its model and timing", async () => {
		const probe = await probeJudge(defaultJudge(), {
			...deps,
			fetchImpl: async () => Response.json({ model: "jev-1.13.0", answers: {} }),
		});

		expect(probe.ok).toBe(true);
		expect(probe.model).toBe("jev-1.13.0");
		expect(probe.elapsedMs).toBeGreaterThanOrEqual(0);
	});

	test("reports a missing key instead of timing out", async () => {
		const probe = await probeJudge(defaultJudge(), {
			...deps,
			resolveApiKey: async () => undefined,
		});

		expect(probe.ok).toBe(false);
		expect(probe.detail).toContain("API key");
	});

	test("reports an HTTP failure", async () => {
		const probe = await probeJudge(defaultJudge(), {
			...deps,
			fetchImpl: async () => new Response("nope", { status: 401 }),
		});

		expect(probe.ok).toBe(false);
		expect(probe.detail).toContain("401");
	});
});

describe("pi model parsing", () => {
	test("pulls JSON out of surrounding prose", () => {
		expect(parseJudgeJson('Sure!\n{"verdict":"deny"}\nDone')).toEqual({ verdict: "deny" });
		expect(parseJudgeJson("no json here")).toBeUndefined();
	});

	test("maps the flat contract", () => {
		const mapped = toAnswersFromJson({
			verdict: "allow",
			confidence: 0.8,
			intent_match: 0.7,
			reversibility: 1,
			sensitive_access: 0.1,
			outside_workspace: 0.2,
		});
		expect(mapped.verdict).toEqual({ choice: "allow", confidence: 0.8 });
		expect(mapped.reversibility).toBe(1);
	});
});

function fakeContext(complete: () => unknown, hasUI = true): ExtensionContext {
	const model = {
		id: "m",
		provider: "p",
		api: "openai-completions",
		baseUrl: "http://localhost",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1000,
		maxTokens: 100,
	};

	return {
		hasUI,
		cwd: "/repo",
		isProjectTrusted: () => true,
		signal: undefined,
		sessionManager: { buildContextEntries: () => [] },
		modelRegistry: {
			find: () => model,
			getAvailable: () => [model],
			complete: async () => complete(),
		},
	} as unknown as ExtensionContext;
}

function allowMessage(): unknown {
	return {
		role: "assistant",
		content: [
			{
				type: "text",
				text: '{"verdict":"allow","confidence":0.99,"intent_match":0.9,"reversibility":0.1,"sensitive_access":0,"outside_workspace":0}',
			},
		],
		stopReason: "stop",
		usage: { input: 10, output: 5 },
	};
}

function askConfig(judge: Partial<JudgeConfig> = {}): PermissionConfig {
	return { ...DEFAULT_CONFIG, judge: { ...defaultJudge(), ...judge } };
}

describe("judge report", () => {
	const base: JudgeRecord = {
		backend: "jev",
		model: "jev-1.13.0",
		answers: {},
		elapsedMs: 1,
		at: 1,
		toolName: "bash",
		summary: "pnpm test",
		action: "allow",
		reason: "the judge approved this call",
	};

	test("summarizes the log newest first", () => {
		const text = judgeLogText([base, { ...base, summary: "rm -rf /", action: "deny" }]);
		expect(text).toContain("2 judge decisions");
		expect(text.indexOf("rm -rf /")).toBeLessThan(text.indexOf("pnpm test"));
	});

	test("marks the would-be action of a dry run", () => {
		const text = judgeLogText([{ ...base, dryRun: true, action: "deny" }]);
		expect(text).toContain("would deny");
	});

	test("describes a verdict with confidence, risk, model, and timing", () => {
		const record: JudgeRecord = {
			...base,
			dryRun: true,
			risk: 0.12,
			elapsedMs: 312,
			answers: { verdict: { choice: "allow", confidence: 0.94 } },
		};

		expect(judgeVerdictText(record)).toBe(
			"would allow \u00b7 94% confident \u00b7 risk 0.12 \u00b7 jev-1.13.0 \u00b7 312ms",
		);
	});

	test("lists the signals behind the verdict", () => {
		const record: JudgeRecord = {
			...base,
			answers: {
				intent_match: 0.9,
				reversibility: 0.2,
				sensitive_access: 0,
				outside_workspace: 0.1,
			},
		};

		expect(judgeSignalText(record)).toBe(
			"intent 0.90 \u00b7 reversibility 0.20 \u00b7 sensitive 0.00 \u00b7 outside 0.10",
		);
	});
});

describe("judgeGate", () => {
	const target = { summary: "pnpm test", levels: ["pnpm", "pnpm test"] };

	test("skips the judge while it is disabled", async () => {
		const outcome = await judgeGate({
			config: askConfig(),
			ctx: fakeContext(allowMessage),
			toolName: "bash",
			target,
			rawInput: {},
			cache: new Map(),
			onStatus: () => {},
		});
		expect(outcome).toBeUndefined();
	});

	test("skips the judge without a UI unless headless judging is on", async () => {
		const outcome = await judgeGate({
			config: askConfig({ enabled: true, backend: "pi", model: "p/m" }),
			ctx: fakeContext(allowMessage, false),
			toolName: "bash",
			target,
			rawInput: {},
			cache: new Map(),
			onStatus: () => {},
		});
		expect(outcome).toBeUndefined();
	});

	test("runs the pi judge, reports status, and caches a clean verdict", async () => {
		const config = askConfig({ enabled: true, backend: "pi", model: "p/m" });
		const cache = new Map<string, NonNullable<Awaited<ReturnType<typeof judgeGate>>>>();
		const statuses: (string | undefined)[] = [];
		let calls = 0;

		const run = () =>
			judgeGate({
				config,
				ctx: fakeContext(() => {
					calls++;
					return allowMessage();
				}),
				toolName: "bash",
				target,
				rawInput: {},
				cache,
				onStatus: (status) => statuses.push(status),
			});

		const first = await run();
		const second = await run();

		expect(first?.action).toBe("allow");
		expect(second).toBe(first);
		expect(calls).toBe(1);
		expect(statuses).toEqual(["judge: considering bash", undefined]);
	});
});
