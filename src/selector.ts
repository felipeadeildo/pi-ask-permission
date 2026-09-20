import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { GRANT_SCOPES, type GrantScope, SCOPE_LABEL } from "./grants.ts";
import { type AskDecision, FALLBACK_OPTIONS } from "./options.ts";
import type { CallTarget } from "./targets.ts";

/** Fallback for RPC and any other UI that cannot host a custom component. */
export async function askViaSelector(
	ctx: ExtensionContext,
	toolName: string,
	target: CallTarget,
): Promise<AskDecision> {
	const labels = FALLBACK_OPTIONS.map((option) => `${option.key}. ${option.label}`);
	const choice = await ctx.ui.select(`Allow ${toolName}?\n${target.summary}`, labels);
	const option = choice ? FALLBACK_OPTIONS[labels.indexOf(choice)] : undefined;
	if (!option) return { decision: "deny" };

	let remember: string | undefined;
	let scope: GrantScope | undefined;
	if (option.always) {
		if (target.levels.length === 1) {
			remember = target.levels[0];
		} else {
			const level = await ctx.ui.select("Always yes for...", target.levels);
			if (!level) return { decision: "deny" };
			remember = level;
		}

		const scopeLabels = GRANT_SCOPES.map((candidate) => SCOPE_LABEL[candidate]);
		const picked = await ctx.ui.select("Remember for...", scopeLabels);
		if (!picked) return { decision: "deny" };
		scope = GRANT_SCOPES[scopeLabels.indexOf(picked)];
	}

	let note: string | undefined;
	if (option.note) {
		const prompt = option.decision === "allow" ? "Note to the agent:" : "Reason for the agent:";
		note = (await ctx.ui.input(prompt))?.trim() || undefined;
	}

	return { decision: option.decision, note, remember, scope };
}
