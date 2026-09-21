export const PERMISSION_MODES = ["manual", "accept-edits", "yolo"] as const;

export type PermissionMode = (typeof PERMISSION_MODES)[number];

export const DEFAULT_MODE: PermissionMode = "manual";

/** Tools that run without a prompt while the session is in `accept-edits`. */
export const EDIT_TOOLS: ReadonlySet<string> = new Set(["edit", "write"]);

export const MODE_LABEL: Record<PermissionMode, string> = {
	manual: "manual",
	"accept-edits": "accept edits",
	yolo: "yolo",
};

export const MODE_DESCRIPTION: Record<PermissionMode, string> = {
	manual: "ask before anything the allow list, grants, and read-only bash do not cover",
	"accept-edits":
		"run file edits and writes without asking or judging; everything else keeps its rules",
	yolo: "run every call without asking, for a throwaway run",
};

export function isPermissionMode(value: unknown): value is PermissionMode {
	return PERMISSION_MODES.some((mode) => mode === value);
}

/** Maps the label shown in the settings list back to the mode id. */
export function modeFromLabel(label: string): PermissionMode | undefined {
	return PERMISSION_MODES.find((mode) => MODE_LABEL[mode] === label);
}

/** Parses a `/perm mode` argument, tolerating a few spellings. */
export function parseMode(text: string): PermissionMode | undefined {
	const value = text.trim().toLowerCase();
	if (value === "accept" || value === "edits" || value === "accept edits") return "accept-edits";
	return isPermissionMode(value) ? value : undefined;
}

export function nextMode(mode: PermissionMode): PermissionMode {
	const index = PERMISSION_MODES.indexOf(mode);
	return PERMISSION_MODES[(index + 1) % PERMISSION_MODES.length] ?? DEFAULT_MODE;
}

/** True when the mode approves this tool before any other rule runs. */
export function modeApproves(mode: PermissionMode, toolName: string): boolean {
	if (mode === "yolo") return true;
	if (mode === "accept-edits") return EDIT_TOOLS.has(toolName);
	return false;
}
