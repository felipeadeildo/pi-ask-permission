/**
 * What a tool call is about, and the levels a user can approve it at. A level
 * doubles as the memory key for "always yes".
 */
import { homedir } from "node:os";
import { dirname } from "node:path";

export interface CallDescriptor {
	summary: string;
	/** Approval levels, coarsest first. Always at least one entry. */
	grantLevels: string[];
}

const FILE_TOOLS = new Set(["read", "write", "edit", "grep", "find", "ls"]);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const INPUT_SUMMARY_MAX = 400;

export function deriveTarget(toolName: string, input: unknown): CallDescriptor {
	const record = (input ?? {}) as Record<string, unknown>;

	if (toolName === "bash" || toolName === "powershell") {
		const command = asString(record.command) ?? "";
		return { summary: command.trim() || "(empty command)", grantLevels: commandLevels(command) };
	}

	if (FILE_TOOLS.has(toolName)) {
		const path = asString(record.path) ?? "";
		return { summary: path.trim() || "(no path)", grantLevels: pathLevels(path) };
	}

	if (toolName === "mcp") return mcpTarget(record);

	return { summary: summarizeInput(record), grantLevels: [toolName] };
}

/** Coarsest to finest: the head, the head plus subcommand, then the whole command. */
export function commandLevels(command: string): string[] {
	const tokens = tokenize(command).filter((token) => !ASSIGNMENT.test(token));
	const head = tokens[0];

	const exact = command.trim();
	if (head === undefined) return [exact || "(empty command)"];

	const levels = [head];
	if (tokens.length > 1) levels.push(tokens.slice(0, 2).join(" "));
	if (!levels.includes(exact)) levels.push(exact);

	return levels;
}

export function pathLevels(path: string): string[] {
	const exact = path.trim();
	if (!exact) return ["(no path)"];

	const display = shortenHome(exact);
	const directory = dirname(display);
	if (directory === "." || directory === display) return [display];

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
		return json.length > INPUT_SUMMARY_MAX ? `${json.slice(0, INPUT_SUMMARY_MAX - 3)}...` : json;
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

function mcpTarget(record: Record<string, unknown>): CallDescriptor {
	const server = asString(record.server);
	const tool = asString(record.tool);

	if (server && tool) {
		return { summary: `${server}:${tool}`, grantLevels: [server, `${server}:${tool}`] };
	}
	if (tool) return { summary: tool, grantLevels: [tool] };
	if (server) return { summary: server, grantLevels: [server] };
	return { summary: summarizeInput(record), grantLevels: ["mcp"] };
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value !== "" ? value : undefined;
}
