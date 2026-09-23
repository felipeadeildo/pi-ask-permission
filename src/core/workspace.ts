import { realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, normalize, resolve, sep } from "node:path";

import type { WorkspaceConfig } from "#core/config/schema.ts";
import { commandWords } from "#core/readonly-bash.ts";
import { FILE_TOOLS } from "#core/target.ts";

// pi and this extension write a pasted image to the top of the temp dir, and reading it
// back is part of the paste.
const PASTED = ["pi-clipboard-", "pi-ask-permission-"];

export interface WorkspaceVerdict {
	outside: boolean;

	/** The first path that left, for the message the user reads. */
	path?: string;
}

// Lexical, plus a realpath when the target exists, so a symlink out of the project
// does not read as inside it.
export function checkWorkspace(
	config: WorkspaceConfig,
	cwd: string,
	toolName: string,
	input: unknown,
): WorkspaceVerdict {
	const paths = candidatePaths(toolName, input);
	if (paths === undefined) return { outside: true };

	const roots = resolveRoots(config.roots, cwd);
	const temp = canonical(tmpdir());
	for (const path of paths) {
		const absolute = canonical(resolvePath(path, cwd));
		if (isPastedFile(absolute, temp)) continue;
		if (!isInside(absolute, roots)) return { outside: true, path };
	}
	return { outside: false };
}

export function resolveRoots(roots: string[], cwd: string): string[] {
	const list = roots.length > 0 ? roots : ["."];
	return list.map((root) => canonical(resolvePath(root, cwd)));
}

// Undefined is a command this module cannot read, which counts as outside.
function candidatePaths(toolName: string, input: unknown): string[] | undefined {
	const record = (input ?? {}) as Record<string, unknown>;

	if (toolName === "bash") {
		return commandPaths(typeof record.command === "string" ? record.command : "");
	}

	if (!FILE_TOOLS.has(toolName)) return [];

	const path = typeof record.path === "string" ? record.path.trim() : "";
	return [path === "" ? "." : path];
}

function commandPaths(command: string): string[] | undefined {
	const words = commandWords(command);
	if (words === undefined) return undefined;

	const paths: string[] = [];
	for (const word of words) {
		const path = pathValue(word);
		if (path !== undefined) paths.push(path);
	}
	return paths;
}

/** `--output=/tmp/x` carries a path, `-n` does not. */
function pathValue(word: string): string | undefined {
	const value = word.startsWith("-") ? word.slice(word.indexOf("=") + 1) : word;
	if (value === "" || value.startsWith("-")) return undefined;
	return /^(~|\/|\.\.?$|\.\.?\/)/.test(value) || value.includes("/") ? value : undefined;
}

function resolvePath(path: string, cwd: string): string {
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return join(homedir(), path.slice(2));
	return resolve(cwd, path);
}

function canonical(path: string): string {
	const lexical = normalize(path);
	try {
		return realpathSync(lexical);
	} catch {
		// A path that does not exist yet (`write`) is judged by its parent.
		try {
			return join(realpathSync(dirname(lexical)), basename(lexical));
		} catch {
			return lexical;
		}
	}
}

function isInside(path: string, roots: string[]): boolean {
	return roots.some((root) => {
		const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
		return path === root || path.startsWith(prefix);
	});
}

function isPastedFile(path: string, temp: string): boolean {
	if (dirname(path) !== temp) return false;
	return PASTED.some((prefix) => basename(path).startsWith(prefix));
}
