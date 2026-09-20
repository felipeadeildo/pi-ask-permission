import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

const QUIET_MS = 1000;
const POLL_MS = 50;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export class TypingMonitor {
	private readonly quietMs: number;
	private readonly maxWaitMs: number | null;
	private lastTypedAt = 0;
	private watching = false;
	private unsubscribe: (() => void) | undefined;

	constructor(quietMs = QUIET_MS, maxWaitMs: number | null = null) {
		this.quietMs = quietMs;
		this.maxWaitMs = maxWaitMs;
	}

	start(ctx: ExtensionContext): void {
		this.stop();
		if (ctx.mode !== "tui") return;

		this.unsubscribe = ctx.ui.onTerminalInput((data) => {
			if (data !== "\r" && data !== "\n" && this.watching) this.lastTypedAt = Date.now();
			return undefined;
		});
		this.watching = true;
	}

	stop(): void {
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		this.watching = false;
		this.lastTypedAt = 0;
	}

	pause(): void {
		this.watching = false;
	}

	resume(): void {
		this.watching = this.unsubscribe !== undefined;
	}

	async waitUntilQuiet(
		signal: AbortSignal | undefined,
		onWait: (waiting: boolean) => void,
	): Promise<void> {
		if (!this.isTyping()) return;

		const deadline = this.maxWaitMs === null ? Infinity : Date.now() + this.maxWaitMs;
		onWait(true);
		try {
			await this.pollUntilQuiet(signal, deadline);
		} finally {
			onWait(false);
		}
	}

	private isTyping(): boolean {
		return Date.now() - this.lastTypedAt < this.quietMs;
	}

	private async pollUntilQuiet(signal: AbortSignal | undefined, deadline: number): Promise<void> {
		if (signal?.aborted || !this.isTyping() || Date.now() >= deadline) return;
		await sleep(POLL_MS);
		return this.pollUntilQuiet(signal, deadline);
	}
}
