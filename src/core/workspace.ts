import { realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, normalize, resolve, sep } from "node:path";

import type { WorkspaceConfig } from "#core/config/schema.ts";

const PASTED_IMAGE_PREFIXES = ["pi-clipboard-", "pi-ask-permission-"];

export interface WorkspaceCheck {
	outside: boolean;
	path?: string;
}

// realpath, so a symlink out of the project does not count as inside.
export function checkWorkspace(
	config: WorkspaceConfig,
	cwd: string,
	paths: string[] | undefined,
): WorkspaceCheck {
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
	return PASTED_IMAGE_PREFIXES.some((prefix) => basename(path).startsWith(prefix));
}
