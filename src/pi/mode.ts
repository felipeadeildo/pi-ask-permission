import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { OutsideScope } from "#core/config/schema.ts";
import { MODE_DESCRIPTION, MODE_LABEL, type PermissionMode } from "#core/mode.ts";
import { NAME } from "#identity";
import { record } from "#pi/session-entries.ts";
import type { SessionState } from "#pi/session.ts";

export const MODE_STATUS = `${NAME}:mode`;

interface ModeChangeOptions {
	/** Announce the change; off when the settings list already shows the row. */
	announce?: boolean;
}

export function setSessionMode(
	pi: ExtensionAPI,
	state: SessionState,
	mode: PermissionMode,
	ctx: ExtensionContext,
	{ announce = true }: ModeChangeOptions = {},
): void {
	if (mode !== state.mode) record(pi, { kind: "mode", mode });
	state.mode = mode;
	renderModeStatus(ctx, mode, state.config.workspace.outside);

	if (announce) {
		ctx.ui.notify(`${NAME}: ${MODE_LABEL[mode]} \u00b7 ${MODE_DESCRIPTION[mode]}`, "info");
	}
}

export function clearModeStatus(ctx: ExtensionContext): void {
	if (!ctx.hasUI) return;
	ctx.ui.setStatus(MODE_STATUS, undefined);
}

export function renderModeStatus(
	ctx: ExtensionContext,
	mode: PermissionMode,
	outside: OutsideScope,
): void {
	if (mode === "manual") {
		clearModeStatus(ctx);
		return;
	}
	if (!ctx.hasUI) return;

	const anywhere = outside === "allow";
	const arrow = mode === "auto" ? "\u23f5\u23f5" : "\u23f5";
	const color = anywhere ? "error" : "warning";
	const label = anywhere ? `${MODE_LABEL[mode]} \u00b7 anywhere` : MODE_LABEL[mode];
	ctx.ui.setStatus(MODE_STATUS, ctx.ui.theme.fg(color, `${arrow} ${label}`));
}
