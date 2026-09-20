import { describe, expect, test } from "bun:test";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { TypingMonitor } from "#ui/typing.ts";

function fakeCtx(mode = "tui") {
	let handler: ((data: string) => void) | undefined;
	const ctx = {
		mode,
		ui: {
			onTerminalInput: (next: (data: string) => void) => {
				handler = next;
				return () => {
					handler = undefined;
				};
			},
		},
	} as unknown as ExtensionContext;

	return {
		ctx,
		type: (data = "a") => handler?.(data),
		subscribed: () => handler !== undefined,
	};
}

describe("typing monitor", () => {
	test("does not wait when nothing was typed", async () => {
		const { ctx } = fakeCtx();
		const typing = new TypingMonitor(30, 1000);
		typing.start(ctx);

		const waits: boolean[] = [];
		await typing.waitUntilQuiet(undefined, (waiting) => waits.push(waiting));
		expect(waits).toEqual([]);
	});

	test("waits after a keystroke and reports it", async () => {
		const { ctx, type } = fakeCtx();
		const typing = new TypingMonitor(30, 1000);
		typing.start(ctx);
		type();

		const waits: boolean[] = [];
		const started = Date.now();
		await typing.waitUntilQuiet(undefined, (waiting) => waits.push(waiting));
		expect(Date.now() - started).toBeGreaterThanOrEqual(25);
		expect(waits).toEqual([true, false]);
	});

	test("keeps resetting while the user types", async () => {
		const { ctx, type } = fakeCtx();
		const typing = new TypingMonitor(40, 5000);
		typing.start(ctx);
		type();

		const interval = setInterval(() => type(), 10);
		setTimeout(() => clearInterval(interval), 150);

		const started = Date.now();
		await typing.waitUntilQuiet(undefined, () => {});
		const elapsed = Date.now() - started;
		expect(elapsed).toBeGreaterThanOrEqual(150);
		expect(elapsed).toBeLessThan(1000);
	});

	test("Enter alone does not hold the dialog back", async () => {
		const { ctx, type } = fakeCtx();
		const typing = new TypingMonitor(30, 1000);
		typing.start(ctx);
		type("\r");

		const waits: boolean[] = [];
		await typing.waitUntilQuiet(undefined, (waiting) => waits.push(waiting));
		expect(waits).toEqual([]);
	});

	test("pause ignores keystrokes", async () => {
		const { ctx, type } = fakeCtx();
		const typing = new TypingMonitor(30, 1000);
		typing.start(ctx);
		typing.pause();
		type();

		const waits: boolean[] = [];
		await typing.waitUntilQuiet(undefined, (waiting) => waits.push(waiting));
		expect(waits).toEqual([]);
	});

	test("does not subscribe outside the TUI", () => {
		const { ctx, subscribed } = fakeCtx("rpc");
		new TypingMonitor(30, 1000).start(ctx);
		expect(subscribed()).toBe(false);
	});
});
