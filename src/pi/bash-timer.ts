import {
	createBashToolDefinition,
	type ExtensionAPI,
	type ExtensionContext,
	getAgentDir,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";

// pi starts the bash "Took" clock when the call appears, before the permission dialog
// answers. This override restarts the clock when the command actually runs.
export function registerBashTimer(pi: ExtensionAPI): void {
	const template = createBashToolDefinition(process.cwd());
	const renderResult = template.renderResult;
	if (!renderResult) return;

	const startedAt = new Map<string, number>();

	pi.on("session_shutdown", () => {
		startedAt.clear();
	});

	const timed: typeof template = {
		...template,
		execute(toolCallId, params, signal, onUpdate, ctx) {
			startedAt.set(toolCallId, Date.now());
			return bashFor(ctx).execute(toolCallId, params, signal, onUpdate, ctx);
		},
		renderResult(result, options, theme, context) {
			const start = startedAt.get(context.toolCallId);
			if (start !== undefined) context.state.startedAt = start;

			const component = renderResult(result, options, theme, context);
			if (!options.isPartial) startedAt.delete(context.toolCallId);
			return component;
		},
	};

	pi.registerTool(timed);
}

// Built per call, like pi's own bash, so `shellPath` and `shellCommandPrefix` follow
// /settings, and an untrusted project's settings.json cannot prefix every command.
function bashFor(ctx: ExtensionContext): ReturnType<typeof createBashToolDefinition> {
	const settings = SettingsManager.create(ctx.cwd, getAgentDir(), {
		projectTrusted: ctx.isProjectTrusted(),
	});
	return createBashToolDefinition(ctx.cwd, {
		commandPrefix: settings.getShellCommandPrefix(),
		shellPath: settings.getShellPath(),
	});
}
