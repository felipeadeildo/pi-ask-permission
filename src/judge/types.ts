import type { CallTarget } from "../targets.ts";
/**
 * The judge contract. A backend turns one tool call into typed signals; compose
 * in `compose.ts` turns those signals into a decision. Nothing here talks to a
 * network, so backends stay swappable and testable.
 */
import type { JudgeBackendId } from "./config.ts";

/** The call, the operator policy, and the context a backend may judge it with. */
export interface JudgeInput {
	toolName: string;
	target: CallTarget;
	/** The tool's raw arguments, capped before they reach a model. */
	rawInput: unknown;
	cwd: string;
	projectTrusted: boolean;
	lastUserMessage?: string;
	policy: string;
	includeConversation: boolean;
}

export type JudgeChoice = "allow" | "deny" | "needs_human";

export interface JudgeChoiceAnswer {
	choice: JudgeChoice;
	confidence: number;
}

/** Signals in the shapes `compose.ts` reads. A missing field is treated as unknown. */
export interface JudgeAnswers {
	verdict?: JudgeChoiceAnswer;
	/** 0..1, does the call serve the user's request? */
	intent_match?: number;
	/** 0..2, how hard the call is to undo. */
	reversibility?: number;
	/** 0..1, does it touch credentials, secrets, or personal data? */
	sensitive_access?: number;
	/** 0..1, does it reach outside the project? */
	outside_workspace?: number;
}

export interface JudgeUsage {
	input?: number;
	output?: number;
}

export interface JudgeAssessment {
	backend: JudgeBackendId;
	/** The versioned model that answered, as reported by the backend. */
	model: string;
	answers: JudgeAnswers;
	elapsedMs: number;
	usage?: JudgeUsage;
}

export interface JudgeBackend {
	readonly id: JudgeBackendId;
	assess(input: JudgeInput, signal: AbortSignal): Promise<JudgeAssessment>;
}

/** What the pipeline does with a judgement. `ask` means the human dialog decides. */
export type JudgeAction = "allow" | "deny" | "ask";

export interface JudgeRecord extends JudgeAssessment {
	at: number;
	toolName: string;
	summary: string;
	risk?: number;
	action: JudgeAction;
	reason: string;
	/** Set when the backend could not answer and `onError` decided. */
	error?: string;
	/** Set when headless resolution answered instead of a person. */
	headless?: boolean;
	/** Set when dry run forced an ask despite a verdict. `action` stays the would-be action. */
	dryRun?: boolean;
}

export interface JudgeOutcome {
	action: JudgeAction;
	reason: string;
	/** Present when a backend produced a verdict; absent for a `never` short-circuit. */
	record?: JudgeRecord;
}

export class JudgeError extends Error {
	constructor(
		message: string,
		readonly code: string,
	) {
		super(message);
		this.name = "JudgeError";
	}
}
