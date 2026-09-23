import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { isPermissionMode, type PermissionMode } from "#core/mode.ts";
import { NAME } from "#identity";
import type { SessionState } from "#pi/session.ts";
import { isRecord } from "#util/primitives.ts";

// The mode and this session's always yes live in the session file, so a reload or a
// resume keeps them, and a fork or a /tree jump sees only its own branch.
export const SESSION_ENTRY = `${NAME}:session`;

export type SessionEntry =
	| { kind: "mode"; mode: PermissionMode }
	| { kind: "always-yes"; toolName: string; level: string }
	| { kind: "forget-always-yes" };

export interface SessionSnapshot {
	mode: PermissionMode;
	alwaysYes: { toolName: string; level: string }[];
}

export function record(pi: ExtensionAPI, entry: SessionEntry): void {
	pi.appendEntry(SESSION_ENTRY, entry);
}

export function replay(branch: readonly unknown[], startMode: PermissionMode): SessionSnapshot {
	const snapshot: SessionSnapshot = { mode: startMode, alwaysYes: [] };

	for (const item of branch) {
		const entry = sessionEntry(item);
		switch (entry?.kind) {
			case "mode":
				snapshot.mode = entry.mode;
				break;
			case "always-yes":
				snapshot.alwaysYes.push({ toolName: entry.toolName, level: entry.level });
				break;
			case "forget-always-yes":
				snapshot.alwaysYes = [];
				break;
		}
	}
	return snapshot;
}

export function restoreSession(state: SessionState, ctx: ExtensionContext): void {
	const snapshot = replay(ctx.sessionManager.getBranch(), state.config.mode);

	state.mode = snapshot.mode;
	state.alwaysYes.forget("session");
	for (const { toolName, level } of snapshot.alwaysYes) {
		state.alwaysYes.add("session", toolName, level);
	}
}

// Written by older versions or edited by hand, so every field is checked.
function sessionEntry(item: unknown): SessionEntry | undefined {
	if (!isRecord(item) || item.type !== "custom" || item.customType !== SESSION_ENTRY) {
		return undefined;
	}

	const data = item.data;
	if (!isRecord(data)) return undefined;

	if (data.kind === "mode" && isPermissionMode(data.mode)) {
		return { kind: "mode", mode: data.mode };
	}
	if (data.kind === "always-yes" && isText(data.toolName) && isText(data.level)) {
		return { kind: "always-yes", toolName: data.toolName, level: data.level };
	}
	if (data.kind === "forget-always-yes") return { kind: "forget-always-yes" };
	return undefined;
}

function isText(value: unknown): value is string {
	return typeof value === "string" && value !== "";
}
