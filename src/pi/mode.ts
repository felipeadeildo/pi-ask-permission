import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { MODE_DESCRIPTION, MODE_LABEL, type PermissionMode } from "#core/mode.ts";
import { NAME } from "#identity";
import type { SessionState } from "#pi/session.ts";

export const MODE_STATUS = `${NAME}:mode`;

interface ModeChangeOptions {
	/** Announce the change; off when the settings list already shows the row. */
	announce?: boolean;
}

export function setSessionMode(
	state: SessionState,
	mode: PermissionMode,
	ctx: ExtensionContext,
	{ announce = true }: ModeChangeOptions = {},
): void {
	state.mode = mode;
	renderModeStatus(ctx, mode);

	if (announce) {
		ctx.ui.notify(`${NAME}: ${MODE_LABEL[mode]} \u00b7 ${MODE_DESCRIPTION[mode]}`, "info");
	}
}

export function clearModeStatus(ctx: ExtensionContext): void {
	if (!ctx.hasUI) return;
	ctx.ui.setStatus(MODE_STATUS, undefined);
}

export function renderModeStatus(ctx: ExtensionContext, mode: PermissionMode): void {
	if (mode === "manual") {
		clearModeStatus(ctx);
		return;
	}
	if (!ctx.hasUI) return;

	const yolo = mode === "yolo";
	const arrow = yolo ? "\u23f5\u23f5" : "\u23f5";
	const color = yolo ? "error" : "warning";
	ctx.ui.setStatus(MODE_STATUS, ctx.ui.theme.fg(color, `${arrow} ${MODE_LABEL[mode]}`));
}
