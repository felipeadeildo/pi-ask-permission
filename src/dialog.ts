/**
 * The permission dialog.
 *
 * Three decisions, numbered so they survive an IME candidate buffer: `1`/`2`/`3`
 * move the highlight and `enter` confirms. Tab arms an inline note on the
 * highlighted row, which turns "yes" into "yes, and..." and "deny" into "deny,
 * because..." without spending three more rows on it.
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

import { GRANT_SCOPES, type GrantScope, SCOPE_LABEL } from "./grants.ts";
import type { CallTarget } from "./targets.ts";

export interface AskDecision {
	decision: "allow" | "deny";
	/** A note on an approval, or the reason on a denial. */
	note?: string;
	/** Level to remember for the rest of the session. */
	remember?: string;
	/** Where to remember it. Only meaningful alongside `remember`. */
	scope?: GrantScope;
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
 * Tab there, so the note modifier gets its own row, which doubles the list.
 */
export const FALLBACK_OPTIONS: (DecisionOption & { note: boolean })[] = BASE_OPTIONS.flatMap(
	(option, index) => [
		{ ...option, key: String(index * 2 + 1), note: false },
		{
			...option,
			key: String(index * 2 + 2),
			note: true,
			label: `${option.label}, ${option.decision === "allow" ? "with a note" : "with a reason"}`,
		},
	],
);

type Phase = "menu" | "levels";

/** Top border chrome: `╭─ ` before the title, ` ╮` after it. */
const TITLE_PREFIX = "\u256d\u2500 ";
const TITLE_SUFFIX = " \u256e";
const TITLE_CHROME_WIDTH = visibleWidth(TITLE_PREFIX) + visibleWidth(TITLE_SUFFIX);

/** Rows of the call summary shown before it is elided. */
const SUMMARY_ROWS = 3;

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
	private scopeIndex = 0;
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
			if (this.noteIndex !== null) this.choose(this.noteIndex);
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
			lines.push(...this.levelLines());
		} else {
			for (const [index, option] of BASE_OPTIONS.entries()) {
				lines.push(this.renderOption(option, index, inner));
			}
			lines.push("");
			lines.push(
				this.theme.fg(
					"dim",
					this.noteIndex === null
						? "\u2191\u2193 or 1-3 pick   enter confirm   tab note   esc deny"
						: "enter confirm   esc back",
				),
			);
		}

		return this.frame(lines, width, inner, `permission \u00b7 ${this.toolName}`);
	}

	private dispatch(data: string): void {
		if (this.phase === "menu" && this.noteIndex !== null) {
			if (matchesKey(data, Key.tab)) this.noteIndex = null;
			else this.noteInput.handleInput(data);
			return;
		}

		if (this.phase === "levels") {
			if (matchesKey(data, Key.up)) this.levelIndex = Math.max(0, this.levelIndex - 1);
			else if (matchesKey(data, Key.down))
				this.levelIndex = Math.min(this.target.levels.length - 1, this.levelIndex + 1);
			else if (matchesKey(data, Key.tab))
				this.scopeIndex = (this.scopeIndex + 1) % GRANT_SCOPES.length;
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

		// The depth picker is also where the scope is chosen, so it opens even when
		// there is only one level to pick.
		if (option.always) {
			this.pending = option;
			this.pendingNote = this.draftNote();
			this.noteIndex = null;
			this.levelIndex = this.target.levels.length - 1;
			this.scopeIndex = 0;
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
			scope: this.currentScope,
		});
	}

	private get currentScope(): GrantScope {
		return GRANT_SCOPES[this.scopeIndex] ?? "session";
	}

	private draftNote(): string | undefined {
		if (this.noteIndex === null) return undefined;
		return this.noteInput.getValue().trim() || undefined;
	}

	private levelLines(): string[] {
		const lines = [this.theme.fg("muted", "always yes for...")];

		for (const [index, level] of this.target.levels.entries()) {
			const active = index === this.levelIndex;
			const marker = active ? this.theme.fg("accent", "\u276f ") : "  ";
			lines.push(marker + this.theme.fg(active ? "accent" : "text", level));
		}

		if (this.pendingNote) lines.push(this.theme.fg("muted", `note: ${this.pendingNote}`));
		lines.push("");
		lines.push(
			this.theme.fg("muted", "scope: ") +
				this.theme.fg("accent", SCOPE_LABEL[this.currentScope]) +
				this.theme.fg("dim", "   (tab to change)"),
		);
		lines.push("");
		lines.push(this.theme.fg("dim", "\u2191\u2193 depth   tab scope   enter confirm   esc back"));
		return lines;
	}

	private renderOption(option: DecisionOption, index: number, inner: number): string {
		const active = index === this.selected;
		const marker = active ? this.theme.fg("accent", "\u276f ") : "  ";
		const key = this.theme.fg(active ? "accent" : "dim", option.key);
		const prefix = `${marker}${key}  `;

		if (this.noteIndex !== index) {
			return `${prefix}${this.theme.fg(active ? option.tone : "text", option.label)}`;
		}

		const room = Math.max(1, inner - visibleWidth(prefix));
		const label = truncateToWidth(`${option.label}, `, room);
		const inputRoom = Math.max(1, room - visibleWidth(label));
		const line = `${prefix}${this.theme.fg(option.tone, label)}${this.noteInput.render(inputRoom)[0] ?? ""}`;
		return truncateToWidth(line, inner);
	}

	private summaryLines(inner: number): string[] {
		const wrapped = wrapTextWithAnsi(this.target.summary || "(no input)", inner);
		const shown = wrapped.slice(0, SUMMARY_ROWS);
		const elideLast = wrapped.length > shown.length;

		return shown.map((line, index) => {
			const text =
				elideLast && index === shown.length - 1
					? `${truncateToWidth(line, Math.max(0, inner - 3))}...`
					: line;
			return this.theme.fg("muted", text);
		});
	}

	private frame(lines: string[], width: number, inner: number, title: string): string[] {
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
		const room = Math.max(0, width - TITLE_CHROME_WIDTH);
		const label = this.theme.fg("accent", truncateToWidth(title, Math.max(0, room - 3), "..."));
		const dashes = Math.max(0, room - visibleWidth(label));

		return (
			this.theme.fg("border", TITLE_PREFIX) +
			label +
			this.theme.fg("border", `${"\u2500".repeat(dashes)}${TITLE_SUFFIX}`)
		);
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
	const option = choice ? FALLBACK_OPTIONS[labels.indexOf(choice)] : undefined;
	if (!option) return { decision: "deny" };

	let remember: string | undefined;
	let scope: GrantScope | undefined;
	if (option.always) {
		if (target.levels.length === 1) {
			remember = target.levels[0];
		} else {
			const level = await ctx.ui.select("Always yes for...", target.levels);
			if (!level) return { decision: "deny" };
			remember = level;
		}

		const scopeLabels = GRANT_SCOPES.map((candidate) => SCOPE_LABEL[candidate]);
		const picked = await ctx.ui.select("Remember for...", scopeLabels);
		if (!picked) return { decision: "deny" };
		scope = GRANT_SCOPES[scopeLabels.indexOf(picked)];
	}

	let note: string | undefined;
	if (option.note) {
		const prompt = option.decision === "allow" ? "Note to the agent:" : "Reason for the agent:";
		note = (await ctx.ui.input(prompt))?.trim() || undefined;
	}

	return { decision: option.decision, note, remember, scope };
}
