export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function warn(warnings: string[], path: string, message: string): void {
	warnings.push(`${path}: ${message}`);
}
