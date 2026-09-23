import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { describe, isRecord } from "#util/primitives.ts";

export type Scope = "session" | "project" | "global";
type SavedScope = Exclude<Scope, "session">;

export const SCOPES: Scope[] = ["session", "project", "global"];
const SAVED_SCOPES: SavedScope[] = ["project", "global"];

export const SCOPE_LABEL: Record<Scope, string> = {
	session: "this session",
	project: "this project",
	global: "everywhere",
};

export const ALWAYS_YES_FILE = "always-yes.json";
const LEGACY_FILE_NAME = "grants.json";

export interface AlwaysYesFiles {
	global: string;
	/** Undefined when the project is not trusted. */
	project?: string;
}

// A tool name cannot hold a NUL, so ("bash\0git", "") never matches ("bash", "git").
const SEPARATOR = "\u0000";

export class AlwaysYes {
	private readonly levels: Record<Scope, Set<string>> = {
		session: new Set(),
		project: new Set(),
		global: new Set(),
	};
	private files: AlwaysYesFiles | undefined;

	open(files: AlwaysYesFiles): string[] {
		this.files = files;
		const warnings: string[] = [];
		for (const scope of SAVED_SCOPES) {
			const path = files[scope];
			if (path === undefined) {
				this.levels[scope] = new Set();
				continue;
			}
			const read = readLevels(adoptLegacyFile(path));
			this.levels[scope] = read.levels;
			if (read.warning) warnings.push(read.warning);
		}
		return warnings;
	}

	has(toolName: string, levels: string[]): boolean {
		return levels.some((level) => {
			const key = keyOf(toolName, level);
			return SCOPES.some((scope) => this.levels[scope].has(key));
		});
	}

	size(scope: Scope): number {
		return this.levels[scope].size;
	}

	total(): number {
		return SCOPES.reduce((sum, scope) => sum + this.size(scope), 0);
	}

	/** Returns why it was not saved. It still holds until pi exits. */
	add(scope: Scope, toolName: string, level: string): string | undefined {
		const key = keyOf(toolName, level);
		this.levels[scope].add(key);
		if (scope === "session") return undefined;

		const path = this.files?.[scope];
		if (path === undefined) return "this project is not trusted, so it was not saved";

		// Another pi may have saved since this one loaded, and a file that does not
		// parse is someone's hand edit, not something to overwrite.
		const read = readLevels(path);
		if (read.warning) return read.warning;

		read.levels.add(key);
		this.levels[scope] = read.levels;
		return writeLevels(path, read.levels);
	}

	forget(scope: Scope | "all"): { removed: number; errors: string[] } {
		const scopes = scope === "all" ? SCOPES : [scope];
		let removed = 0;
		const errors: string[] = [];

		for (const target of scopes) {
			removed += this.levels[target].size;
			this.levels[target].clear();
			if (target === "session") continue;

			const path = this.files?.[target];
			if (path === undefined) continue;
			try {
				rmSync(path, { force: true });
			} catch (error) {
				errors.push(describe(error));
			}
		}

		return { removed, errors };
	}
}

export function savedFileExists(path: string): boolean {
	return existsSync(path) || existsSync(legacyPath(path));
}

export function readLevels(path: string): { levels: Set<string>; warning?: string } {
	if (!existsSync(path)) return { levels: new Set() };

	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		return { levels: new Set(), warning: `could not parse ${path}: ${describe(error)}` };
	}
	if (!isRecord(raw)) return { levels: new Set(), warning: `${path} must contain a JSON object` };

	const levels = new Set<string>();
	for (const [tool, list] of Object.entries(raw)) {
		if (!Array.isArray(list)) continue;
		for (const level of list) {
			if (typeof level === "string" && level !== "") levels.add(keyOf(tool, level));
		}
	}
	return { levels };
}

function writeLevels(path: string, levels: Set<string>): string | undefined {
	try {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, `${JSON.stringify(toFile(levels), null, 2)}\n`, "utf8");
		return undefined;
	} catch (error) {
		return describe(error);
	}
}

// Before 3.0 the file was grants.json. A failed rename reads it in place.
function adoptLegacyFile(path: string): string {
	const legacy = legacyPath(path);
	if (existsSync(path) || !existsSync(legacy)) return path;

	try {
		renameSync(legacy, path);
		return path;
	} catch {
		return legacy;
	}
}

function legacyPath(path: string): string {
	return join(dirname(path), LEGACY_FILE_NAME);
}

function keyOf(toolName: string, level: string): string {
	return `${toolName}${SEPARATOR}${level}`;
}

function toFile(levels: Set<string>): Record<string, string[]> {
	const byTool = new Map<string, string[]>();

	for (const key of levels) {
		const separator = key.indexOf(SEPARATOR);
		const tool = key.slice(0, separator);
		const list = byTool.get(tool) ?? [];
		list.push(key.slice(separator + 1));
		byTool.set(tool, list);
	}

	return Object.fromEntries(
		[...byTool]
			.toSorted(([left], [right]) => left.localeCompare(right))
			.map(([tool, list]) => [tool, list.toSorted()]),
	);
}
