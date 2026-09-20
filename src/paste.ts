export const PASTE_START = "\x1b[200~";
export const PASTE_END = "\x1b[201~";

const MARKER = /\[paste #(\d+)(?:\s[^\]]*)?\]/g;
const MAX_CHARS = 1000;

/** Line endings normalized, tabs expanded, control characters dropped, newlines kept. */
export function cleanPaste(text: string): string {
	return text
		.replace(/\r\n?/g, "\n")
		.replace(/\t/g, "    ")
		.split("")
		.filter((char) => char === "\n" || char.charCodeAt(0) >= 32)
		.join("");
}

/** A newline or a wall of text cannot fit the single-line note, so it becomes a marker. */
export function shouldCollapse(text: string): boolean {
	return text.includes("\n") || text.length > MAX_CHARS;
}

export function pasteMarker(id: number, text: string): string {
	const lines = text.split("\n").length;
	return lines > 1 ? `[paste #${id} +${lines} lines]` : `[paste #${id} ${text.length} chars]`;
}

/** Puts the pasted text back in place of its marker. */
export function expandPastes(text: string, pastes: Map<number, string>): string {
	return text.replace(MARKER, (match, id: string) => pastes.get(Number(id)) ?? match);
}
