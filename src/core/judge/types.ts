import type { JudgeBackendId } from "#core/judge/config.ts";
import type { CallDescriptor } from "#core/target.ts";

export interface JudgeInput {
	toolName: string;
	target: CallDescriptor;
	rawInput: unknown;
	cwd: string;
	policy: string;
}

export type JudgeChoice = "allow" | "deny" | "needs_human";

export interface JudgeChoiceAnswer {
	choice: JudgeChoice;
	confidence: number;
}

export interface JudgeAnswers {
	verdict?: JudgeChoiceAnswer;
	reversibility?: number;
	sensitive_access?: number;
	outside_workspace?: number;
}

export interface JudgeUsage {
	input?: number;
	output?: number;
}

export interface JudgeAssessment {
	backend: JudgeBackendId;

	model: string;
	answers: JudgeAnswers;
	elapsedMs: number;
	usage?: JudgeUsage;
}

export interface JudgeBackend {
	readonly id: JudgeBackendId;
	assess(input: JudgeInput, signal: AbortSignal): Promise<JudgeAssessment>;
}

export type JudgeAction = "allow" | "deny" | "ask";

export interface JudgeRecord extends JudgeAssessment {
	at: number;
	toolName: string;
	summary: string;
	risk?: number;
	action: JudgeAction;
	reason: string;
	error?: string;
	headless?: boolean;

	dryRun?: boolean;
}

export interface JudgeOutcome {
	action: JudgeAction;
	reason: string;
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
