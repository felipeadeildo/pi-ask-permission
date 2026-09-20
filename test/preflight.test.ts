import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { editFailure } from "../src/preflight.ts";

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

describe("edit preflight", () => {
	test("passes an edit that applies", async () => {
		const failure = await editFailure(ctx, {
			path: "sample.txt",
			edits: [{ oldText: "beta", newText: "BETA" }],
		});
		expect(failure).toBeUndefined();
	});

	test("reports a missing oldText", async () => {
		const failure = await editFailure(ctx, {
			path: "sample.txt",
			edits: [{ oldText: "nope", newText: "x" }],
		});
		expect(failure).toContain("Could not find");
	});

	test("reports a duplicated oldText", async () => {
		await writeFile(join(dir, "sample.txt"), "a\na\n", "utf8");
		const failure = await editFailure(ctx, {
			path: "sample.txt",
			edits: [{ oldText: "a", newText: "b" }],
		});
		expect(failure).toContain("unique");
	});

	test("reports a file that cannot be read", async () => {
		const failure = await editFailure(ctx, {
			path: "gone.txt",
			edits: [{ oldText: "a", newText: "b" }],
		});
		expect(failure).toContain("Could not edit file");
	});

	test("never writes", async () => {
		await editFailure(ctx, {
			path: "sample.txt",
			edits: [{ oldText: "beta", newText: "BETA" }],
		});
		expect(await readFile(join(dir, "sample.txt"), "utf8")).toBe(CONTENT);
	});
});
