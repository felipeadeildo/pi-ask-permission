/**
 * The permission dialog.
 *
 * Three decisions, numbered so they survive an IME candidate buffer and so the
 * whole answer is one keystroke. Tab arms an inline note on the highlighted
 * row, which turns "yes" into "yes, and..." and "deny" into "deny, because..."
 * without spending three more rows on it.
 *
 * "always yes" opens a depth picker first: the levels come from the call
 * itself, so you approve `git`, `git status`, or the exact command as typed.
 */
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	type Focusable,
	Input,
	Key,
	matchesKey,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

import type { CallTarget } from "./targets.ts";

export interface AskDecision {
	decision: "allow" | "deny";
	/** A note on an approval, or the reason on a denial. */
	note?: string;
	/** Level to remember for the rest of the session. */
	remember?: string;
}

export interface DecisionOption {
	key: string;
	decision: "allow" | "deny";
	always: boolean;
	label: string;
	tone: "success" | "warning" | "error";
}

/** The three rows of the TUI dialog. */
export const BASE_OPTIONS: DecisionOption[] = [
	{ key: "1", decision: "allow", always: false, label: "yes", tone: "success" },
	{ key: "2", decision: "allow", always: true, label: "always yes", tone: "warning" },
	{ key: "3", decision: "deny", always: false, label: "deny", tone: "error" },
];

/**
 * Flat list for UI contexts that cannot host the component (RPC). There is no
 * Tab there, so the note modifier gets its own row.
 */
export const FALLBACK_OPTIONS: (DecisionOption & { note: boolean })[] = [
	{ key: "1", decision: "allow", always: false, note: false, label: "yes", tone: "success" },
	{
		key: "2",
		decision: "allow",
		always: false,
		note: true,
		label: "yes, with a note",
		tone: "success",
	},
	{ key: "3", decision: "allow", always: true, note: false, label: "always yes", tone: "warning" },
	{
		key: "4",
		decision: "allow",
		always: true,
		note: true,
		label: "always yes, with a note",
		tone: "warning",
	},
	{ key: "5", decision: "deny", always: false, note: false, label: "deny", tone: "error" },
	{
		key: "6",
		decision: "deny",
		always: false,
		note: true,
		label: "deny, with a reason",
		tone: "error",
	},
];

type Phase = "menu" | "levels";

interface AskDialogOptions {
	theme: Theme;
	toolName: string;
	target: CallTarget;
	requestRender: () => void;
	complete: (decision: AskDecision) => void;
}

export class AskDialog implements Component, Focusable {
	private readonly theme: Theme;
	private readonly toolName: string;
	private readonly target: CallTarget;
	private readonly requestRender: () => void;
	private readonly complete: (decision: AskDecision) => void;
	private readonly noteInput = new Input({ prompt: "", placeholder: "" });

	private phase: Phase = "menu";
	private selected = 0;
	private levelIndex = 0;
	private pending: DecisionOption | null = null;
	/** Row whose inline note editor is open, or null when none is. */
	private noteIndex: number | null = null;
	/** Remembers the draft across a Tab toggle so re-arming does not lose typing. */
	private lastArmed: number | null = null;
	/** Note carried from the menu into the depth picker. */
	private pendingNote: string | undefined;

	private focusedFlag = false;
	get focused(): boolean {
		return this.focusedFlag;
	}
	set focused(value: boolean) {
		this.focusedFlag = value;
		this.noteInput.focused = value;
	}

	constructor(options: AskDialogOptions) {
		this.theme = options.theme;
		this.toolName = options.toolName;
		this.target = options.target;
		this.requestRender = options.requestRender;
		this.complete = options.complete;

		this.noteInput.onSubmit = () => {
			const index = this.noteIndex;
			if (index === null) return;
			this.choose(index);
		};
		this.noteInput.onEscape = () => {
			this.noteIndex = null;
		};
	}

	handleInput(data: string): void {
		try {
			this.dispatch(data);
		} finally {
			this.requestRender();
		}
	}

	invalidate(): void {
		this.noteInput.invalidate();
	}

	render(width: number): string[] {
		const inner = Math.max(1, width - 4);
		const lines: string[] = this.summaryLines(inner);
		lines.push("");

		if (this.phase === "levels") {
			lines.push(this.theme.fg("muted", "always yes for..."));
			this.target.levels.forEach((level, index) => {
				const active = index === this.levelIndex;
				const marker = active ? this.theme.fg("accent", "\u276f ") : "  ";
				lines.push(marker + this.theme.fg(active ? "accent" : "text", level));
			});
			if (this.pendingNote) lines.push(this.theme.fg("muted", `note: ${this.pendingNote}`));
			lines.push("");
			lines.push(this.hint("\u2191\u2193 choose depth   enter confirm   esc back"));
		} else {
			BASE_OPTIONS.forEach((_option, index) => lines.push(this.renderOption(index, inner)));
			lines.push("");
			lines.push(
				this.hint(
					this.noteIndex === null
						? "\u2191\u2193 or 1-3 pick   enter confirm   tab note   esc deny"
						: "enter confirm   esc back",
				),
			);
		}

		return this.frame(lines, width, `permission \u00b7 ${this.toolName}`);
	}

	private dispatch(data: string): void {
		if (this.phase === "menu" && this.noteIndex !== null) {
			if (matchesKey(data, Key.tab)) {
				this.noteIndex = null;
				return;
			}
			this.noteInput.handleInput(data);
			return;
		}

		if (this.phase === "levels") {
			if (matchesKey(data, Key.up)) this.levelIndex = Math.max(0, this.levelIndex - 1);
			else if (matchesKey(data, Key.down))
				this.levelIndex = Math.min(this.target.levels.length - 1, this.levelIndex + 1);
			else if (matchesKey(data, Key.enter)) this.confirmLevel();
			else if (matchesKey(data, Key.escape)) this.phase = "menu";
			return;
		}

		if (matchesKey(data, Key.up)) {
			this.selected = (this.selected + BASE_OPTIONS.length - 1) % BASE_OPTIONS.length;
			return;
		}
		if (matchesKey(data, Key.down)) {
			this.selected = (this.selected + 1) % BASE_OPTIONS.length;
			return;
		}
		if (matchesKey(data, Key.tab)) {
			this.arm(this.selected);
			return;
		}
		if (matchesKey(data, Key.enter)) {
			this.choose(this.selected);
			return;
		}
		if (matchesKey(data, Key.escape)) {
			this.complete({ decision: "deny" });
			return;
		}

		// Digits move the highlight rather than deciding, so every row can be
		// combined with Tab (note) and Enter (confirm) the same way.
		const picked = BASE_OPTIONS.findIndex((option) => option.key === data);
		if (picked >= 0) this.selected = picked;
	}

	private arm(index: number): void {
		if (this.lastArmed !== index) this.noteInput.setValue("");
		this.lastArmed = index;
		this.noteIndex = index;
		this.selected = index;
	}

	private choose(index: number): void {
		const option = BASE_OPTIONS[index];
		if (!option) return;
		this.selected = index;

		if (option.always && this.target.levels.length > 1) {
			this.pending = option;
			this.pendingNote = this.draftNote();
			this.noteIndex = null;
			this.levelIndex = this.target.levels.length - 1;
			this.phase = "levels";
			return;
		}

		this.complete({
			decision: option.decision,
			note: this.draftNote(),
			remember: option.always ? this.target.levels[0] : undefined,
		});
	}

	private confirmLevel(): void {
		const level = this.target.levels[this.levelIndex];
		if (!this.pending || level === undefined) return;
		this.complete({
			decision: this.pending.decision,
			note: this.pendingNote,
			remember: level,
		});
	}

	private draftNote(): string | undefined {
		if (this.noteIndex === null) return undefined;
		return this.noteInput.getValue().trim() || undefined;
	}

	private renderOption(index: number, inner: number): string {
		const option = BASE_OPTIONS[index];
		if (!option) return "";
		const active = index === this.selected;
		const marker = active ? this.theme.fg("accent", "\u276f ") : "  ";
		const key = this.theme.fg(active ? "accent" : "dim", option.key);
		const prefix = `${marker}${key}  `;

		if (this.noteIndex === index) {
			const prefixWidth = 5;
			const room = Math.max(1, inner - prefixWidth);
			const label = truncateToWidth(`${option.label}, `, room);
			const inputRoom = Math.max(1, inner - prefixWidth - visibleWidth(label));
			const line = `${prefix}${this.theme.fg(option.tone, label)}${this.noteInput.render(inputRoom)[0] ?? ""}`;
			return truncateToWidth(line, inner);
		}

		return `${prefix}${this.theme.fg(active ? option.tone : "text", option.label)}`;
	}

	private summaryLines(inner: number): string[] {
		const wrapped = wrapTextWithAnsi(this.target.summary || "(no input)", inner);
		const shown = wrapped.slice(0, 3);

		if (wrapped.length > shown.length && shown.length > 0) {
			const last = shown.length - 1;
			const previous = shown[last];
			if (previous !== undefined)
				shown[last] = `${truncateToWidth(previous, Math.max(0, inner - 3))}...`;
		}

		return shown.map((line) => this.theme.fg("muted", line));
	}

	private hint(text: string): string {
		return this.theme.fg("dim", text);
	}

	private frame(lines: string[], width: number, title: string): string[] {
		const inner = Math.max(1, width - 4);
		const out: string[] = [this.topBorder(width, title)];

		for (const line of lines) {
			const clipped = truncateToWidth(line, inner);
			const pad = " ".repeat(Math.max(0, inner - visibleWidth(clipped)));
			out.push(
				`${this.theme.fg("border", "\u2502")} ${clipped}${pad} ${this.theme.fg("border", "\u2502")}`,
			);
		}

		out.push(this.theme.fg("border", `\u2570${"\u2500".repeat(Math.max(0, width - 2))}\u256f`));
		return out;
	}

	private topBorder(width: number, title: string): string {
		const prefix = "\u256d\u2500 ";
		const suffix = " \u256e";
		const room = Math.max(0, width - visibleWidth(prefix) - visibleWidth(suffix));
		const label = this.theme.fg("accent", truncateToWidth(title, Math.max(0, room - 3), "..."));
		const dashes = Math.max(0, room - visibleWidth(label));
		return `${this.theme.fg("border", prefix)}${label}${this.theme.fg("border", `${"\u2500".repeat(dashes)}${suffix}`)}`;
	}
}

/** Fallback for RPC and any other UI that cannot host a custom component. */
export async function askViaSelector(
	ctx: ExtensionContext,
	toolName: string,
	target: CallTarget,
): Promise<AskDecision> {
	const labels = FALLBACK_OPTIONS.map((option) => `${option.key}. ${option.label}`);
	const choice = await ctx.ui.select(`Allow ${toolName}?\n${target.summary}`, labels);
	if (!choice) return { decision: "deny" };

	const option = FALLBACK_OPTIONS.find(
		(candidate) => `${candidate.key}. ${candidate.label}` === choice,
	);
	if (!option) return { decision: "deny" };

	let remember: string | undefined;
	if (option.always) {
		if (target.levels.length > 1) {
			const level = await ctx.ui.select("Always yes for...", target.levels);
			if (!level) return { decision: "deny" };
			remember = level;
		} else {
			remember = target.levels[0];
		}
	}

	let note: string | undefined;
	if (option.note) {
		const answer = await ctx.ui.input(
			option.decision === "allow" ? "Note to the agent:" : "Reason for the agent:",
		);
		note = answer?.trim() || undefined;
	}

	return { decision: option.decision, note, remember };
}
