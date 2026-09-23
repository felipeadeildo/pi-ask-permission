export const PERMISSION_MODES = ["manual", "accept-edits", "auto"] as const;

export type PermissionMode = (typeof PERMISSION_MODES)[number];

export const DEFAULT_MODE: PermissionMode = "manual";

export const MODE_LABEL: Record<PermissionMode, string> = {
	manual: "manual",
	"accept-edits": "accept edits",
	auto: "auto",
};

export const MODE_DESCRIPTION: Record<PermissionMode, string> = {
	manual: "ask before anything the allow list, grants, and read-only bash do not cover",
	"accept-edits": "run file edits and writes in the workspace without asking",
	auto: "run every call in the workspace without asking; outside follows workspace.outside",
};

export function isPermissionMode(value: unknown): value is PermissionMode {
	return PERMISSION_MODES.some((mode) => mode === value);
}

export function modeFromLabel(label: string): PermissionMode | undefined {
	return PERMISSION_MODES.find((mode) => MODE_LABEL[mode] === label);
}

export function parseMode(text: string): PermissionMode | undefined {
	const value = text.trim().toLowerCase();
	if (value === "accept" || value === "edits" || value === "accept edits") return "accept-edits";
	return isPermissionMode(value) ? value : undefined;
}

export function nextMode(mode: PermissionMode): PermissionMode {
	const index = PERMISSION_MODES.indexOf(mode);
	return PERMISSION_MODES[(index + 1) % PERMISSION_MODES.length] ?? DEFAULT_MODE;
}

export function modeApproves(mode: PermissionMode, edits: boolean): boolean {
	if (mode === "auto") return true;
	if (mode === "accept-edits") return edits;
	return false;
}
