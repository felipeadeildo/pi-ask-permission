/**
 * What a tool call is about, and the nesting levels a user can approve it at.
 *
 * The same level strings double as the memory keys for "always yes": approving
 * `git` remembers the level `git`, and a later call whose own levels include
 * `git` is already approved. Approving the finest level therefore remembers
 * exactly the call in front of you, and coarser levels widen the grant by
 * prefix.
 */
import { homedir } from "node:os";
import { dirname } from "node:path";

export interface CallTarget {
	/** One-line description of the call, for the dialog header. */
	summary: string;
	/** Approval levels, coarsest first. Always at least one entry. */
	levels: string[];
}

const FILE_TOOLS = new Set(["read", "write", "edit", "grep", "find", "ls"]);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

export function deriveTarget(toolName: string, input: unknown, _cwd: string): CallTarget {
	const record = (input ?? {}) as Record<string, unknown>;

	if (toolName === "bash" || toolName === "powershell") {
		const command = typeof record.command === "string" ? record.command : "";
		return { summary: command.trim() || "(empty command)", levels: commandLevels(command) };
	}

	if (FILE_TOOLS.has(toolName)) {
		const path = typeof record.path === "string" ? record.path : "";
		return { summary: path.trim() || "(no path)", levels: pathLevels(path) };
	}

	if (toolName === "mcp") return mcpTarget(record);

	return { summary: summarizeInput(record), levels: [toolName] };
}

/**
 * Coarsest to finest: `git`, `git status`, the command as typed. A leading
 * environment assignment is skipped for the coarse levels so the gate is about
 * the command, not the environment it runs in.
 */
export function commandLevels(command: string): string[] {
	const tokens = tokenize(command).filter((token) => !ASSIGNMENT.test(token));
	const exact = command.trim();

	if (tokens.length === 0) return [exact || "(empty command)"];

	const levels: string[] = [];
	const push = (value: string) => {
		const trimmed = value.trim();
		if (trimmed && !levels.includes(trimmed)) levels.push(trimmed);
	};

	const head = tokens[0];
	if (head === undefined) return [exact || "(empty command)"];

	push(head);
	if (tokens.length > 1) push(tokens.slice(0, 2).join(" "));
	push(exact);

	return levels;
}

/** The containing directory, then the path itself. */
export function pathLevels(path: string): string[] {
	const exact = path.trim();
	if (!exact) return ["(no path)"];

	const display = shortenHome(exact);
	const directory = dirname(display);
	if (!directory || directory === "." || directory === display) return [display];

	return [directory, display];
}

export function shortenHome(path: string): string {
	const home = homedir();
	if (!home) return path;
	if (path === home) return "~";
	if (path.startsWith(`${home}/`) || path.startsWith(`${home}\\`))
		return `~${path.slice(home.length)}`;
	return path;
}

export function summarizeInput(input: Record<string, unknown>): string {
	const keys = Object.keys(input);
	if (keys.length === 0) return "(no input)";
	try {
		const json = JSON.stringify(input);
		return json.length > 400 ? `${json.slice(0, 397)}...` : json;
	} catch {
		return `{ ${keys.join(", ")} }`;
	}
}

/** Splits a shell command into words, respecting quotes and backslash escapes. */
export function tokenize(command: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let quote: '"' | "'" | null = null;

	for (let index = 0; index < command.length; index++) {
		const char = command[index];
		if (char === undefined) break;

		if (quote) {
			if (char === quote) quote = null;
			else current += char;
			continue;
		}

		if (char === '"' || char === "'") {
			quote = char;
			continue;
		}

		if (char === "\\" && index + 1 < command.length) {
			const escaped = command[index + 1];
			if (escaped !== undefined) current += escaped;
			index++;
			continue;
		}

		if (/\s/.test(char)) {
			if (current) {
				tokens.push(current);
				current = "";
			}
			continue;
		}

		current += char;
	}

	if (current) tokens.push(current);
	return tokens;
}

function mcpTarget(record: Record<string, unknown>): CallTarget {
	const server = typeof record.server === "string" ? record.server : undefined;
	const tool = typeof record.tool === "string" ? record.tool : undefined;

	if (server && tool) {
		return { summary: `${server}:${tool}`, levels: [server, `${server}:${tool}`] };
	}
	if (tool) return { summary: tool, levels: [tool] };
	if (server) return { summary: server, levels: [server] };
	return { summary: summarizeInput(record), levels: ["mcp"] };
}
