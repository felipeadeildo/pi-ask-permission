import { createBashToolDefinition, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * The built-in bash renderer starts its clock at `tool_execution_start`, which
 * runs before the permission dialog, so the time you spend approving lands in
 * the "Took" line. Re-register bash with the same renderer and stamp the clock
 * when the command actually starts.
 */
export function registerBashTimer(pi: ExtensionAPI): void {
	const definition = createBashToolDefinition(process.cwd());
	const renderResult = definition.renderResult;
	if (!renderResult) return;

	const startedAt = new Map<string, number>();

	pi.on("session_shutdown", () => {
		startedAt.clear();
	});

	const override: typeof definition = {
		...definition,
		execute(toolCallId, params, signal, onUpdate, ctx) {
			startedAt.set(toolCallId, Date.now());
			return definition.execute(toolCallId, params, signal, onUpdate, ctx);
		},
		renderResult(result, options, theme, context) {
			const start = startedAt.get(context.toolCallId);
			if (start !== undefined) context.state.startedAt = start;

			const component = renderResult(result, options, theme, context);
			if (!options.isPartial) startedAt.delete(context.toolCallId);
			return component;
		},
	};

	pi.registerTool(override);
}
