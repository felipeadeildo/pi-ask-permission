import type { AlwaysYes } from "#core/always-yes.ts";
import { isAllowed } from "#core/config/patterns.ts";
import type { OutsideScope, PermissionConfig } from "#core/config/schema.ts";
import { modeApproves, type PermissionMode } from "#core/mode.ts";
import {
	asToolInput,
	type CallDescriptor,
	type CustomTools,
	shortenHome,
	type ToolAdapter,
	toolAdapter,
	type ToolInput,
} from "#core/tools.ts";
import { checkWorkspace } from "#core/workspace.ts";
import { NAME } from "#identity";

export interface Call {
	toolName: string;
	input: ToolInput;
	target: CallDescriptor;
	tool: ToolAdapter;
	outside: boolean;
	outsidePath?: string;
}

export type Verdict =
	| { action: "allow" }
	| { action: "block"; reason: string }
	| { action: "ask"; reason?: string };

export type Decision = (Verdict & { by: string }) | { action: "ask" };

export interface Layer {
	name: string;
	decide(call: Call): Verdict | undefined | Promise<Verdict | undefined>;
}

export interface GateState {
	config: PermissionConfig;
	mode: PermissionMode;
	alwaysYes: Pick<AlwaysYes, "has">;
}

const ALLOW: Verdict = { action: "allow" };

export function describeCall(
	toolName: string,
	rawInput: unknown,
	cwd: string,
	config: PermissionConfig,
	custom?: CustomTools,
): Call {
	const input = asToolInput(rawInput);
	const tool = toolAdapter(toolName, custom);
	const call: Call = { toolName, input, tool, target: tool.describe(input), outside: false };
	if (config.workspace.outside === "allow") return call;

	const workspace = checkWorkspace(config.workspace, cwd, tool.paths(input));
	return { ...call, outside: workspace.outside, outsidePath: workspace.path };
}

export function gateLayers(state: GateState): Layer[] {
	return [
		{
			name: "always yes",
			decide: (call) =>
				state.alwaysYes.has(call.toolName, call.target.levels) ? ALLOW : undefined,
		},
		{
			name: "workspace",
			decide: (call) => outsideVerdict(call, state.config.workspace.outside),
		},
		{
			name: "mode",
			decide: (call) => (modeApproves(state.mode, call.tool.edits === true) ? ALLOW : undefined),
		},
		{
			name: "allow list",
			decide: (call) => (isAllowed(state.config, call.toolName) ? ALLOW : undefined),
		},
		{
			name: "read-only bash",
			decide: (call) =>
				state.config.readOnlyBash && call.tool.readOnly?.(call.input) ? ALLOW : undefined,
		},
	];
}

export async function decide(call: Call, layers: Layer[]): Promise<Decision> {
	for (const layer of layers) {
		// oxlint-disable-next-line no-await-in-loop -- a layer runs only when the earlier ones passed.
		const verdict = await layer.decide(call);
		if (verdict) return { ...verdict, by: layer.name };
	}
	return { action: "ask" };
}

// Asking here keeps the judge from approving a call that left.
function outsideVerdict(call: Call, outside: OutsideScope): Verdict | undefined {
	if (!call.outside) return undefined;

	const where = call.outsidePath === undefined ? "" : ` (${shortenHome(call.outsidePath)})`;
	const reason = `outside the workspace${where}`;
	if (outside === "deny") return { action: "block", reason: `${NAME}: ${reason}` };
	return { action: "ask", reason };
}
