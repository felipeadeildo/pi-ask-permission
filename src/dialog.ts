/**
 * The permission dialog: three numbered decisions, Tab for an inline note, and
 * a depth picker behind "always yes".
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
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
import { type AskDecision, BASE_OPTIONS, type DecisionOption } from "./options.ts";
import type { CallTarget } from "./targets.ts";

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
	/** One note editor per row, so each row keeps its own draft. */
	private readonly noteInputs: Input[];

	private phase: Phase = "menu";
	private selected = 0;
	private levelIndex = 0;
	private scopeIndex = 0;
	private pending: DecisionOption | null = null;
	private noteIndex: number | null = null;
	/** Note carried from the menu into the depth picker. */
	private pendingNote: string | undefined;

	private get activeNoteInput(): Input | undefined {
		return this.noteIndex === null ? undefined : this.noteInputs[this.noteIndex];
	}

	private focusedFlag = false;
	get focused(): boolean {
		return this.focusedFlag;
	}
	set focused(value: boolean) {
		this.focusedFlag = value;
		for (const input of this.noteInputs) input.focused = value;
	}

	constructor(options: AskDialogOptions) {
		this.theme = options.theme;
		this.toolName = options.toolName;
		this.target = options.target;
		this.requestRender = options.requestRender;
		this.complete = options.complete;

		this.noteInputs = [...BASE_OPTIONS.keys()].map((index) => {
			const input = new Input({ prompt: "", placeholder: "" });
			input.onSubmit = () => this.choose(index);
			input.onEscape = () => {
				this.noteIndex = null;
			};
			return input;
		});
	}

	handleInput(data: string): void {
		try {
			this.dispatch(data);
		} finally {
			this.requestRender();
		}
	}

	invalidate(): void {
		for (const input of this.noteInputs) input.invalidate();
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
						: "\u2191\u2193 pick   enter confirm   esc back",
				),
			);
		}

		return this.frame(lines, width, inner, `permission \u00b7 ${this.toolName}`);
	}

	private dispatch(data: string): void {
		if (this.phase === "menu" && this.noteIndex !== null) {
			if (matchesKey(data, Key.up)) this.moveNote(-1);
			else if (matchesKey(data, Key.down)) this.moveNote(1);
			else if (matchesKey(data, Key.tab)) this.noteIndex = null;
			else this.activeNoteInput?.handleInput(data);
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
			this.moveSelection(-1);
			return;
		}
		if (matchesKey(data, Key.down)) {
			this.moveSelection(1);
			return;
		}
		if (matchesKey(data, Key.tab)) {
			this.noteIndex = this.selected;
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

		// Digits move the highlight; Tab and Enter then act on that row.
		const picked = BASE_OPTIONS.findIndex((option) => option.key === data);
		if (picked >= 0) this.selected = picked;
	}

	/** Moves the highlight, wrapping at the ends. */
	private moveSelection(delta: number): void {
		const count = BASE_OPTIONS.length;
		this.selected = (this.selected + delta + count) % count;
	}

	/** Moves the highlight and the open note editor together. */
	private moveNote(delta: number): void {
		if (this.noteIndex === null) return;
		this.moveSelection(delta);
		this.noteIndex = this.selected;
	}

	private choose(index: number): void {
		const option = BASE_OPTIONS[index];
		if (!option) return;
		this.selected = index;

		// The depth picker also picks the scope, so it opens even for a single level.
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
		return this.activeNoteInput?.getValue().trim() || undefined;
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
		const editing = this.noteIndex === index;
		const input = this.noteInputs[index];
		const draft = input?.getValue().trim() ?? "";
		const marker = active ? this.theme.fg("accent", "\u276f ") : "  ";
		const key = this.theme.fg(active ? "accent" : "dim", option.key);
		const prefix = `${marker}${key}  `;

		if (!editing && !draft) {
			return `${prefix}${this.theme.fg(active ? option.tone : "text", option.label)}`;
		}

		const room = Math.max(1, inner - visibleWidth(prefix));
		const label = truncateToWidth(`${option.label}, `, room);
		const noteRoom = Math.max(1, room - visibleWidth(label));
		const note = editing
			? (input?.render(noteRoom)[0] ?? "")
			: this.theme.fg("dim", truncateToWidth(draft, noteRoom));
		const head = this.theme.fg(active ? option.tone : "text", label);
		return truncateToWidth(`${prefix}${head}${note}`, inner);
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
