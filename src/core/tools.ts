import { homedir } from "node:os";
import { dirname } from "node:path";

import { commandWords, isReadOnlyCommand } from "#core/readonly-bash.ts";

export interface CallDescriptor {
	summary: string;
	levels: string[];
}

export type ToolInput = Record<string, unknown>;

export interface ToolAdapter {
	describe(input: ToolInput): CallDescriptor;
	/** Undefined counts as outside the workspace. */
	paths(input: ToolInput): string[] | undefined;
	edits?: boolean;
	readOnly?(input: ToolInput): boolean;
}

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const INPUT_SUMMARY_MAX = 400;

const bash: ToolAdapter = {
	describe: commandTarget,
	paths: (input) => commandPaths(text(input.command) ?? ""),
	readOnly: (input) => isReadOnlyCommand(text(input.command) ?? ""),
};

const powershell: ToolAdapter = {
	describe: commandTarget,
	paths: () => undefined,
};

const fileReader: ToolAdapter = {
	describe: (input) => {
		const path = text(input.path) ?? "";
		return { summary: path.trim() || "(no path)", levels: pathLevels(path) };
	},
	paths: (input) => [text(input.path)?.trim() || "."],
};

const fileWriter: ToolAdapter = { ...fileReader, edits: true };

const mcp: ToolAdapter = {
	describe: mcpTarget,
	paths: () => [],
};

const BUILT_IN: Record<string, ToolAdapter> = {
	bash,
	powershell,
	read: fileReader,
	grep: fileReader,
	find: fileReader,
	ls: fileReader,
	write: fileWriter,
	edit: fileWriter,
	mcp,
};

export type CustomTools = ReadonlyMap<string, Partial<ToolAdapter>>;

export function toolAdapter(toolName: string, custom: CustomTools = new Map()): ToolAdapter {
	const builtIn = BUILT_IN[toolName];
	if (builtIn) return builtIn;

	return {
		describe: (input) => ({ summary: summarizeInput(input), levels: [toolName] }),
		paths: () => [],
		...custom.get(toolName),
	};
}

export function isBuiltInTool(toolName: string): boolean {
	return toolName in BUILT_IN;
}

export function asToolInput(input: unknown): ToolInput {
	return typeof input === "object" && input !== null ? (input as ToolInput) : {};
}

function commandTarget(input: ToolInput): CallDescriptor {
	const command = text(input.command) ?? "";
	return { summary: command.trim() || "(empty command)", levels: commandLevels(command) };
}

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

export function commandPaths(command: string): string[] | undefined {
	const words = commandWords(command);
	if (words === undefined) return undefined;

	const paths: string[] = [];
	for (const word of words) {
		const path = pathValue(word);
		if (path !== undefined) paths.push(path);
	}
	return paths;
}

function pathValue(word: string): string | undefined {
	const value = word.startsWith("-") ? word.slice(word.indexOf("=") + 1) : word;
	if (value === "" || value.startsWith("-")) return undefined;
	return /^(~|\/|\.\.?$|\.\.?\/)/.test(value) || value.includes("/") ? value : undefined;
}

export function shortenHome(path: string): string {
	const home = homedir();
	if (!home) return path;
	if (path === home) return "~";
	if (path.startsWith(`${home}/`) || path.startsWith(`${home}\\`))
		return `~${path.slice(home.length)}`;
	return path;
}

export function summarizeInput(input: ToolInput): string {
	const keys = Object.keys(input);
	if (keys.length === 0) return "(no input)";

	try {
		const json = JSON.stringify(input);
		return json.length > INPUT_SUMMARY_MAX ? `${json.slice(0, INPUT_SUMMARY_MAX - 3)}...` : json;
	} catch {
		return `{ ${keys.join(", ")} }`;
	}
}

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

function mcpTarget(input: ToolInput): CallDescriptor {
	const server = text(input.server);
	const tool = text(input.tool);

	if (server && tool) {
		return { summary: `${server}:${tool}`, levels: [server, `${server}:${tool}`] };
	}
	if (tool) return { summary: tool, levels: [tool] };
	if (server) return { summary: server, levels: [server] };
	return { summary: summarizeInput(input), levels: ["mcp"] };
}

function text(value: unknown): string | undefined {
	return typeof value === "string" && value !== "" ? value : undefined;
}
