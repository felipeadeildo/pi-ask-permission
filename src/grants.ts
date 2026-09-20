/**
 * Persisted "always yes" grants, stored as `{ [tool]: [level] }`. Session grants
 * stay in memory; project and global grants each get their own grants.json.
 * Project grants are read only for a trusted project.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { describe, isRecord } from "./util/primitives.ts";

export type GrantScope = "session" | "project" | "global";

/** Cycle order in the dialog: narrowest first. */
export const GRANT_SCOPES: GrantScope[] = ["session", "project", "global"];

export const SCOPE_LABEL: Record<GrantScope, string> = {
	session: "this session",
	project: "this project",
	global: "everywhere",
};

export interface LoadedGrants {
	grants: Set<string>;
	found: boolean;
	warning?: string;
}

const SEPARATOR = "\u0000";

export function grantKey(toolName: string, level: string): string {
	return `${toolName}${SEPARATOR}${level}`;
}

export function grantsFileExists(path: string): boolean {
	return existsSync(path);
}

export function loadGrants(path: string): LoadedGrants {
	if (!existsSync(path)) return { grants: new Set(), found: false };

	try {
		const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (!isRecord(raw)) {
			return { grants: new Set(), found: true, warning: `${path} must contain a JSON object` };
		}

		const grants = new Set<string>();
		for (const [tool, levels] of Object.entries(raw)) {
			if (!Array.isArray(levels)) continue;
			for (const level of levels) {
				if (typeof level === "string" && level !== "") grants.add(grantKey(tool, level));
			}
		}
		return { grants, found: true };
	} catch (error) {
		return {
			grants: new Set(),
			found: true,
			warning: `could not parse ${path}: ${describe(error)}`,
		};
	}
}

export function saveGrants(path: string, grants: Set<string>): string | undefined {
	try {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, `${JSON.stringify(toFile(grants), null, 2)}\n`, "utf8");
		return undefined;
	} catch (error) {
		return describe(error);
	}
}

export function deleteGrants(path: string): string | undefined {
	try {
		if (existsSync(path)) rmSync(path);
		return undefined;
	} catch (error) {
		return describe(error);
	}
}

/** Groups the flat key set back into the on-disk shape, with stable ordering. */
function toFile(grants: Set<string>): Record<string, string[]> {
	const byTool = new Map<string, string[]>();

	for (const key of grants) {
		const separator = key.indexOf(SEPARATOR);
		if (separator < 0) continue;

		const tool = key.slice(0, separator);
		const levels = byTool.get(tool) ?? [];
		levels.push(key.slice(separator + 1));
		byTool.set(tool, levels);
	}

	return Object.fromEntries(
		[...byTool]
			.toSorted(([left], [right]) => left.localeCompare(right))
			.map(([tool, levels]) => [tool, levels.toSorted()]),
	);
}
