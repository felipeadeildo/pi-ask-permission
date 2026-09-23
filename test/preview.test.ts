import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { type FileChange, type PendingWrites, previewEdit, previewWrite } from "#pi/preview.ts";

const CONTENT = "alpha\nbeta\ngamma\n";

let dir: string;
let ctx: ExtensionContext;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "pi-ask-permission-"));
	await writeFile(join(dir, "sample.txt"), CONTENT, "utf8");
	ctx = { cwd: dir } as unknown as ExtensionContext;
});

afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

function edit(
	oldText: string,
	newText: string,
	pending: PendingWrites = new Map(),
): Promise<FileChange> {
	return previewEdit(ctx, { path: "sample.txt", edits: [{ oldText, newText }] }, pending);
}

function errorOf(change: FileChange): string | undefined {
	return "error" in change ? change.error : undefined;
}

describe("edit preview", () => {
	test("shows the change an edit would make", async () => {
		const change = await edit("beta", "BETA");
		expect(errorOf(change)).toBeUndefined();
		expect("diff" in change && change.diff).toContain("+2 BETA");
	});

	test("reports a missing oldText", async () => {
		expect(errorOf(await edit("nope", "x"))).toContain("Could not find");
	});

	test("reports a duplicated oldText", async () => {
		await writeFile(join(dir, "sample.txt"), "a\na\n", "utf8");
		expect(errorOf(await edit("a", "b"))).toContain("unique");
	});

	test("reports a file that cannot be read", async () => {
		const change = await previewEdit(
			ctx,
			{ path: "gone.txt", edits: [{ oldText: "a", newText: "b" }] },
			new Map(),
		);
		expect(errorOf(change)).toContain("Could not edit file");
	});

	test("never writes", async () => {
		await edit("beta", "BETA");
		expect(await readFile(join(dir, "sample.txt"), "utf8")).toBe(CONTENT);
	});

	test("an approved edit that has not run yet is the base for the next one", async () => {
		const first = await edit("beta", "BETA");
		if ("error" in first) throw new Error(first.error);
		const pending: PendingWrites = new Map([
			[first.path, { toolCallId: "call-1", after: first.after }],
		]);

		const second = await edit("BETA", "Beta");
		expect(errorOf(second)).toContain("Could not find");
		expect(errorOf(await edit("BETA", "Beta", pending))).toBeUndefined();
	});
});

describe("write preview", () => {
	test("a new file is all additions", async () => {
		const change = await previewWrite(ctx, { path: "new.txt", content: "hello\n" }, new Map());
		expect("diff" in change && change.diff).toContain("+1 hello");
	});
});
