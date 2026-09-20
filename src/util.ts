export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** A finite number in [0, 1], for confidences and thresholds. */
export function isUnit(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

/** A non-negative finite number of milliseconds. */
export function isDuration(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function warn(warnings: string[], path: string, message: string): void {
	warnings.push(`${path}: ${message}`);
}
