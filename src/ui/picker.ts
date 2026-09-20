/**
 * A small select list for nested settings submenus. `SettingsList` cycles
 * values on Enter, which reads badly for a picker, so this one selects.
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	Key,
	matchesKey,
	truncateToWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

export interface PickerItem {
	id: string;
	label: string;
	description?: string;
}

export class PickerList implements Component {
	private selected: number;

	constructor(
		private readonly title: string,
		private readonly items: PickerItem[],
		private readonly theme: Theme,
		private readonly onChoose: (id: string) => void,
		private readonly onCancel: () => void,
		private readonly maxVisible = 8,
		selectedId?: string,
	) {
		const index = items.findIndex((item) => item.id === selectedId);
		this.selected = index < 0 ? 0 : index;
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.up)) {
			this.selected = Math.max(0, this.selected - 1);
			return;
		}
		if (matchesKey(data, Key.down)) {
			this.selected = Math.min(this.items.length - 1, this.selected + 1);
			return;
		}
		if (matchesKey(data, Key.enter)) {
			const item = this.items[this.selected];
			if (item) this.onChoose(item.id);
			return;
		}
		if (matchesKey(data, Key.escape)) this.onCancel();
	}

	invalidate(): void {}

	render(width: number): string[] {
		const inner = Math.max(1, width - 4);
		const lines: string[] = [this.theme.fg("accent", this.theme.bold(this.title))];

		const { start, end } = this.window();
		for (let index = start; index < end; index++) {
			const item = this.items[index];
			if (!item) continue;

			const active = index === this.selected;
			const marker = active ? this.theme.fg("accent", "\u276f ") : "  ";
			const label = this.theme.fg(active ? "accent" : "text", item.label);
			lines.push(truncateToWidth(`${marker}${label}`, inner));
		}

		if (end < this.items.length) {
			lines.push(this.theme.fg("dim", `  \u2026 ${this.items.length - end} more`));
		}

		const description = this.items[this.selected]?.description;
		if (description) {
			lines.push("");
			for (const line of wrapTextWithAnsi(description, inner)) {
				lines.push(this.theme.fg("muted", line));
			}
		}

		lines.push("");
		lines.push(this.theme.fg("dim", "\u2191\u2193 pick   enter select   esc back"));
		return lines;
	}

	private window(): { start: number; end: number } {
		if (this.items.length <= this.maxVisible) return { start: 0, end: this.items.length };

		const half = Math.floor(this.maxVisible / 2);
		const start = Math.min(Math.max(0, this.selected - half), this.items.length - this.maxVisible);
		return { start, end: start + this.maxVisible };
	}
}
