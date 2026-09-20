import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { PermissionDecision } from "#core/decision.ts";
import { GRANT_SCOPES, type GrantScope, SCOPE_LABEL } from "#core/grants.ts";
import type { CallDescriptor } from "#core/target.ts";
import { FALLBACK_CHOICES } from "#ui/decision-options.ts";

export async function askViaSelector(
	ctx: ExtensionContext,
	toolName: string,
	target: CallDescriptor,
): Promise<PermissionDecision> {
	const labels = FALLBACK_CHOICES.map((option) => `${option.key}. ${option.label}`);
	const choice = await ctx.ui.select(`Allow ${toolName}?\n${target.summary}`, labels);
	const option = choice ? FALLBACK_CHOICES[labels.indexOf(choice)] : undefined;
	if (!option) return { decision: "deny" };

	let remember: string | undefined;
	let scope: GrantScope | undefined;
	if (option.always) {
		if (target.grantLevels.length === 1) {
			remember = target.grantLevels[0];
		} else {
			const level = await ctx.ui.select("Always yes for...", target.grantLevels);
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
