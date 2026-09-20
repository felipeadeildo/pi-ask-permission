/**
 * The TypeSafe (Jev) backend. Jev is not a chat model: it evaluates a state
 * against typed questions and returns probabilities and confidence. The
 * extension registers an auth-only `typesafe` provider so `/login typesafe`
 * stores the key through pi, and calls the System One endpoint directly.
 */
import { describe, isRecord } from "../util.ts";
import { buildJudgeQuestions, buildJudgeState } from "./state.ts";
import {
	JudgeError,
	type JudgeAnswers,
	type JudgeAssessment,
	type JudgeBackend,
	type JudgeChoiceAnswer,
	type JudgeInput,
	type JudgeUsage,
} from "./types.ts";

export const TYPESAFE_PROVIDER = "typesafe";
export const TYPESAFE_BASE_URL = "https://api.typesafe.ai/v1";

const ENDPOINT = `${TYPESAFE_BASE_URL}/systemone`;
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 4000;

export interface JevBackendOptions {
	/** A Jev model id or alias, such as `jev-latest` or a pinned `jev-1.13.0`. */
	model: string;
	timeoutMs: number;
	/** Resolved per call, so `/login` and runtime key changes take effect. */
	resolveApiKey: () => Promise<string | undefined>;
	fetchImpl?: JudgeFetch;
}

/** The slice of `fetch` this client needs, so tests can pass a plain function. */
export type JudgeFetch = (
	url: string,
	init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<Response>;

export function createJevBackend(options: JevBackendOptions): JudgeBackend {
	return {
		id: "jev",
		async assess(input: JudgeInput, signal: AbortSignal): Promise<JudgeAssessment> {
			const started = Date.now();
			const apiKey = await options.resolveApiKey();
			if (!apiKey) {
				throw new JudgeError(
					`no TypeSafe API key: run "/login ${TYPESAFE_PROVIDER}" or set TYPESAFE_API_KEY`,
					"no-api-key",
				);
			}

			const body = JSON.stringify({
				state: buildJudgeState(input),
				model: options.model,
				questions: buildJudgeQuestions(input),
			});

			const response = await send(
				options.fetchImpl ?? fetch,
				body,
				apiKey,
				options.timeoutMs,
				signal,
			);
			if (!response.ok) {
				const detail = await response.text().catch(() => "");
				throw new JudgeError(
					`TypeSafe returned ${response.status}${detail ? `: ${clip(detail, 200)}` : ""}`,
					`http-${response.status}`,
				);
			}

			const payload: unknown = await response.json().catch(() => undefined);
			const parsed = parseJevResponse(payload, options.model);
			return { ...parsed, backend: "jev", elapsedMs: Date.now() - started };
		},
	};
}

async function send(
	fetchImpl: JudgeFetch,
	body: string,
	apiKey: string,
	timeoutMs: number,
	signal: AbortSignal,
): Promise<Response> {
	// `timeoutMs` is the budget for the whole call, retries and backoff included,
	// so a slow backoff can never be mistaken for a slow server.
	const deadline = Date.now() + timeoutMs;
	let retryable: Response | undefined;

	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		const remaining = deadline - Date.now();
		if (remaining <= 0) break;

		const timeout = AbortSignal.timeout(remaining);
		const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;

		let response: Response;
		try {
			// oxlint-disable-next-line no-await-in-loop -- a retry must wait for the previous attempt.
			response = await fetchImpl(ENDPOINT, {
				method: "POST",
				headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
				body,
				signal: requestSignal,
			});
		} catch (error) {
			// The caller aborted: let it through so the pipeline can stop too.
			if (signal.aborted) throw error;
			if (error instanceof JudgeError) throw error;
			if (isAbort(error, "AbortError")) throw new JudgeError("cancelled", "cancelled");
			if (isAbort(error, "TimeoutError")) break;
			throw new JudgeError(describe(error), "network");
		}

		if (response.status !== 429 && response.status !== 529) return response;
		retryable = response;

		if (attempt >= MAX_ATTEMPTS) break;
		const delay = Math.min(backoff(response, attempt), deadline - Date.now());
		if (delay < 0) break;

		// oxlint-disable-next-line no-await-in-loop -- backoff is deliberately serial.
		await sleep(delay, signal);
	}

	// A rate limit we could not outlast is reported as itself, not as a timeout.
	if (retryable) return retryable;

	throw new JudgeError(
		`no response from ${ENDPOINT} within ${timeoutMs}ms (check the network or proxy, or raise judge.timeoutMs)`,
		"timeout",
	);
}

/** `retry-after` wins when present; otherwise exponential backoff, both capped. */
function backoff(response: Response, attempt: number): number {
	const header = response.headers.get("retry-after");
	const seconds = header === null ? Number.NaN : Number(header);
	if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_BACKOFF_MS);
	return Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal.aborted) {
			reject(signal.reason ?? new Error("aborted"));
			return;
		}

		const onAbort = () => {
			clearTimeout(timer);
			reject(signal.reason ?? new Error("aborted"));
		};
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		signal.addEventListener("abort", onAbort, { once: true });
	});
}

function isAbort(error: unknown, name: string): boolean {
	return typeof error === "object" && error !== null && (error as { name?: unknown }).name === name;
}

export function parseJevResponse(
	payload: unknown,
	fallbackModel: string,
): { model: string; answers: JudgeAnswers; usage?: JudgeUsage } {
	if (!isRecord(payload))
		throw new JudgeError("TypeSafe returned an unexpected body", "bad-response");

	const answers = isRecord(payload.answers) ? payload.answers : undefined;
	if (!answers) throw new JudgeError("TypeSafe returned no answers", "bad-response");

	return {
		model:
			typeof payload.model === "string" && payload.model !== "" ? payload.model : fallbackModel,
		answers: toAnswers(answers),
		usage: toUsage(payload.usage),
	};
}

/** Maps System One answers onto the signals `compose.ts` reads. */
export function toAnswers(raw: Record<string, unknown>): JudgeAnswers {
	return {
		verdict: toVerdict(raw.verdict),
		intent_match: toNoul(raw.intent_match),
		reversibility: toScore(raw.reversibility),
		sensitive_access: toNoul(raw.sensitive_access),
		outside_workspace: toNoul(raw.outside_workspace),
	};
}

function toVerdict(raw: unknown): JudgeChoiceAnswer | undefined {
	if (!isRecord(raw)) return undefined;

	const { choice, confidence } = raw;
	if (
		(choice === "allow" || choice === "deny" || choice === "needs_human") &&
		typeof confidence === "number"
	) {
		return { choice, confidence: clamp01(confidence) };
	}
	return undefined;
}

function toNoul(raw: unknown): number | undefined {
	if (!isRecord(raw)) return undefined;
	return typeof raw.noul === "number" ? clamp01(raw.noul) : undefined;
}

function toScore(raw: unknown): number | undefined {
	if (!isRecord(raw)) return undefined;
	return typeof raw.score === "number" ? Math.min(2, Math.max(0, raw.score)) : undefined;
}

function toUsage(raw: unknown): JudgeUsage | undefined {
	if (!isRecord(raw)) return undefined;

	const input = typeof raw.input_tokens === "number" ? raw.input_tokens : undefined;
	const output = typeof raw.output_tokens === "number" ? raw.output_tokens : undefined;
	if (input === undefined && output === undefined) return undefined;

	const usage: JudgeUsage = {};
	if (input !== undefined) usage.input = input;
	if (output !== undefined) usage.output = output;
	return usage;
}

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}

function clip(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}
