import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { type Scope, SCOPE_LABEL, SCOPES } from "#core/always-yes.ts";
import type { DialogAnswer } from "#core/answer.ts";
import type { CallDescriptor } from "#core/tools.ts";
import { FALLBACK_CHOICES } from "#ui/decision-options.ts";

export async function askViaSelector(
	ctx: ExtensionContext,
	toolName: string,
	target: CallDescriptor,
): Promise<DialogAnswer> {
	const labels = FALLBACK_CHOICES.map((option) => `${option.key}. ${option.label}`);
	const choice = await ctx.ui.select(`Allow ${toolName}?\n${target.summary}`, labels);
	const option = choice ? FALLBACK_CHOICES[labels.indexOf(choice)] : undefined;
	if (!option) return { decision: "deny" };

	let remember: string | undefined;
	let scope: Scope | undefined;
	if (option.always) {
		if (target.levels.length === 1) {
			remember = target.levels[0];
		} else {
			const level = await ctx.ui.select("Always yes for...", target.levels);
			if (!level) return { decision: "deny" };
			remember = level;
		}

		const scopeLabels = SCOPES.map((candidate) => SCOPE_LABEL[candidate]);
		const picked = await ctx.ui.select("Remember for...", scopeLabels);
		if (!picked) return { decision: "deny" };
		scope = SCOPES[scopeLabels.indexOf(picked)];
	}

	let note: string | undefined;
	if (option.note) {
		const prompt = option.decision === "allow" ? "Note to the agent:" : "Reason for the agent:";
		note = (await ctx.ui.input(prompt))?.trim() || undefined;
	}

	return { decision: option.decision, note, remember, scope };
}
