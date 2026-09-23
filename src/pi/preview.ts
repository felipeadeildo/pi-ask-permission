import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import {
	createEditToolDefinition,
	type EditToolInput,
	type ExtensionContext,
	generateDiffString,
	type WriteToolInput,
} from "@earendil-works/pi-coding-agent";

import { describe } from "#util/primitives.ts";

export type FileChange = { error: string } | { path: string; after: string; diff: string };

/** Approved edits and writes that have not run yet, by absolute path. */
export type PendingWrites = Map<string, { toolCallId: string; after: string }>;

// pi's own edit tool, run with a writeFile that keeps the result, so the preview and the
// error are exactly what the real call would produce.
export async function previewEdit(
	ctx: ExtensionContext,
	input: EditToolInput,
	pending: PendingWrites,
): Promise<FileChange> {
	let before = "";
	let written: { path: string; after: string } | undefined;

	const dryRun = createEditToolDefinition(ctx.cwd, {
		operations: {
			access: (path) =>
				pending.has(path) ? Promise.resolve() : access(path, constants.R_OK | constants.W_OK),
			readFile: async (path) => {
				const content = pending.get(path)?.after ?? (await readFile(path, "utf8"));
				before = content;
				return Buffer.from(content);
			},
			writeFile: async (path, content) => {
				written = { path, after: content };
			},
		},
	});

	try {
		await dryRun.execute("preview", input, ctx.signal, undefined, ctx);
	} catch (error) {
		return { error: describe(error) };
	}
	if (!written) return { error: "the edit changed nothing" };
	return { ...written, diff: generateDiffString(before, written.after).diff };
}

export async function previewWrite(
	ctx: ExtensionContext,
	input: WriteToolInput,
	pending: PendingWrites,
): Promise<FileChange> {
	const path = absolute(input.path, ctx.cwd);
	const before = pending.get(path)?.after ?? (await readFile(path, "utf8").catch(() => ""));
	return { path, after: input.content, diff: generateDiffString(before, input.content).diff };
}

function absolute(path: string, cwd: string): string {
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return join(homedir(), path.slice(2));
	return resolve(cwd, path);
}
