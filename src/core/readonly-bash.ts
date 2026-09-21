import { parse, type ParseEntry } from "shell-quote";

const SEPARATORS = new Set(["&&", "||", ";", "|", "&"]);
const FIND_ACTIONS = [
	"-exec",
	"-execdir",
	"-ok",
	"-okdir",
	"-delete",
	"-fprint",
	"-fprint0",
	"-fprintf",
	"-fls",
];
const GIT_READ_ONLY = new Set([
	"status",
	"diff",
	"log",
	"show",
	"blame",
	"annotate",
	"shortlog",
	"describe",
	"rev-parse",
	"rev-list",
	"ls-files",
	"ls-tree",
	"ls-remote",
	"cat-file",
	"show-ref",
	"for-each-ref",
	"symbolic-ref",
	"merge-base",
	"name-rev",
	"whatchanged",
	"reflog",
	"cherry",
	"grep",
	"diff-tree",
	"diff-index",
	"diff-files",
	"verify-commit",
	"verify-tag",
	"count-objects",
	"fsck",
	"var",
	"version",
	"help",
	"check-ignore",
	"check-attr",
	"check-ref-format",
]);
const GIT_EXEC_FLAGS = [
	"-O",
	"--open-files-in-pager",
	"--ext-diff",
	"--textconv",
	"--use-textconv",
];
const GIT_BRANCH_FLAGS = new Set([
	"-a",
	"--all",
	"-r",
	"--remotes",
	"-l",
	"--list",
	"-v",
	"--verbose",
	"-i",
	"--ignore-case",
	"--show-current",
	"--no-column",
	"--no-color",
]);
const GIT_BRANCH_SHORT_LETTERS = new Set(["a", "r", "l", "v", "i"]);
// These take their value as a separate word, so the next token belongs to the flag.
const GIT_BRANCH_VALUE_FLAGS = new Set([
	"--contains",
	"--no-contains",
	"--merged",
	"--no-merged",
	"--points-at",
	"--sort",
	"--format",
]);
// Git only reads an optional value when it is attached with `=`, so a separate word
// stays a branch name and must not be swallowed here.
const GIT_BRANCH_OPTIONAL_VALUE_FLAGS = new Set(["--color", "--column", "--abbrev"]);
const GIT_REMOTE_FLAGS = new Set(["-v", "--verbose"]);
const GIT_REMOTE_SUBCOMMANDS = new Set(["show", "get-url"]);

const READ_ONLY = new Set([
	"cat",
	"head",
	"tail",
	"wc",
	"ls",
	"pwd",
	"cd",
	":",
	"echo",
	"printf",
	"grep",
	"egrep",
	"fgrep",
	"diff",
	"cmp",
	"comm",
	"cut",
	"tr",
	"nl",
	"od",
	"xxd",
	"strings",
	"file",
	"stat",
	"du",
	"df",
	"basename",
	"dirname",
	"readlink",
	"realpath",
	"whoami",
	"id",
	"groups",
	"uname",
	"uptime",
	"free",
	"ps",
	"printenv",
	"which",
	"type",
	"whereis",
	"locale",
	"tty",
	"md5sum",
	"sha1sum",
	"sha256sum",
	"sha512sum",
	"cksum",
	"sum",
	"test",
	"true",
	"false",
	"sleep",
	"seq",
	"expr",
	"jq",
	"rev",
	"tac",
	"expand",
	"unexpand",
	"numfmt",
	"fmt",
	"fold",
	"column",
	"base64",
	"[",
]);

function hasNoOutputFlag(args: string[]): boolean {
	return !args.some(isOutputFlag);
}

const ARG_CHECKS: Record<string, (args: string[]) => boolean> = {
	rg: (args) => !args.some((arg) => isOneOf(arg, ["--pre", "--hostname-bin"])),
	find: (args) => !args.some((arg) => isOneOf(arg, FIND_ACTIONS)),
	sort: hasNoOutputFlag,
	tree: hasNoOutputFlag,
	date: (args) => !args.some((arg) => arg.startsWith("-s") || arg.startsWith("--set")),
	uniq: (args) => args.filter((arg) => !arg.startsWith("-")).length <= 1,
	hostname: (args) =>
		args.every((arg) => arg.startsWith("-") && !arg.startsWith("--file") && !/^-F./.test(arg)),
	sed: safeSed,
	git: safeGit,
};

// A classifier, not a sandbox: names are matched as written.
export function isReadOnlyCommand(command: string, env: NodeJS.ProcessEnv = process.env): boolean {
	if (/[\r\n]/.test(command)) return false;
	if (env.BASH_ENV) return false;
	if (hasCommandSubstitution(command)) return false;

	let tokens: ParseEntry[];
	try {
		tokens = parse(command);
	} catch {
		return false;
	}

	let segment: string[] = [];
	for (let index = 0; index < tokens.length; index++) {
		const token = tokens[index];
		if (token === undefined) continue;
		if (typeof token === "string") {
			segment.push(token);
			continue;
		}
		if ("comment" in token) continue;
		if (token.op === "glob") {
			segment.push(token.pattern);
			continue;
		}

		const consumed = safeRedirect(tokens, index);
		if (consumed !== undefined) {
			index += consumed;
			dropFileDescriptor(segment);
			continue;
		}

		if (!SEPARATORS.has(token.op)) return false;
		if (!isReadOnlySegment(segment, env)) return false;
		segment = [];
	}
	return isReadOnlySegment(segment, env);
}

// Backticks and `$(` run commands, unless single quotes make them literal.
function hasCommandSubstitution(command: string): boolean {
	let singleQuoted = false;

	for (let index = 0; index < command.length; index++) {
		const char = command[index];
		if (char === "'") {
			singleQuoted = !singleQuoted;
			continue;
		}
		if (singleQuoted) continue;
		if (char === "\\") {
			index++;
			continue;
		}
		if (char === "`") return true;
		if (char === "$" && command[index + 1] === "(") return true;
	}

	return false;
}

function operatorOf(entry: ParseEntry | undefined): string | undefined {
	if (entry === undefined || typeof entry === "string" || !("op" in entry)) return undefined;
	return entry.op;
}

// Redirections to `/dev/null` and fd duplications do not touch the filesystem.
// Returns how many following tokens the redirect consumed.
function safeRedirect(tokens: ParseEntry[], index: number): number | undefined {
	const op = operatorOf(tokens[index]);
	if (op === undefined) return undefined;

	if (op === "&") {
		const inner = operatorOf(tokens[index + 1]);
		if (inner !== ">" && inner !== ">>") return undefined;
		return tokens[index + 2] === "/dev/null" ? 2 : undefined;
	}

	if (op === ">" || op === "<") {
		return tokens[index + 1] === "/dev/null" ? 1 : undefined;
	}

	if (op === ">&") {
		const target = tokens[index + 1];
		return target === "1" || target === "2" ? 1 : undefined;
	}

	return undefined;
}

// `ls 2>/dev/null` parses the descriptor as a plain word before the operator.
function dropFileDescriptor(segment: string[]): void {
	if (segment.at(-1) === "1" || segment.at(-1) === "2") segment.pop();
}

function isReadOnlySegment(words: string[], env: NodeJS.ProcessEnv): boolean {
	let start = 0;
	while (words[start] === "!") start++;

	const name = words[start];
	if (name === undefined) return true;
	if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(name)) return false;
	if (env[`BASH_FUNC_${name}%%`] !== undefined) return false;

	const check = ARG_CHECKS[name];
	return check ? check(words.slice(start + 1)) : READ_ONLY.has(name);
}

function safeSed(args: string[]): boolean {
	const scripts: string[] = [];
	let sawScript = false;

	for (let index = 0; index < args.length; index++) {
		const arg = args[index] ?? "";
		if (/^-[^-]*[if]/.test(arg) || arg.startsWith("--in-place") || arg.startsWith("--file"))
			return false;
		if (arg === "-e" || arg === "--expression") {
			scripts.push(args[++index] ?? "");
			sawScript = true;
			continue;
		}
		if (arg.startsWith("--expression=")) {
			scripts.push(arg.slice("--expression=".length));
			sawScript = true;
			continue;
		}
		if (arg.startsWith("-")) continue;
		if (sawScript) continue;
		scripts.push(arg);
		sawScript = true;
	}

	return scripts.length > 0 && scripts.every(safeSedScript);
}

const SED_ADDRESS = String.raw`(?:\d+|\$|\/[^/]*\/)`;
const SED_ADDRESS_RANGE = new RegExp(`^${SED_ADDRESS}(?:,${SED_ADDRESS})?[pd]$`);

function safeSedScript(script: string): boolean {
	if (script.includes("{") || script.includes("}")) return false;
	return script.split(/[;\n]/).every((part) => {
		const piece = part.trim();
		if (piece === "") return true;
		if (SED_ADDRESS_RANGE.test(piece)) return true;

		const substitution = /^s(.)[\s\S]*?\1[\s\S]*?\1([gip0-9]*)$/.exec(piece);
		return substitution !== null && !/[we]/.test(substitution[2] ?? "");
	});
}

function safeGit(args: string[]): boolean {
	if (args.some((arg) => isOneOf(arg, GIT_EXEC_FLAGS))) return false;

	let index = 0;
	while (index < args.length) {
		const arg = args[index] ?? "";
		if (arg === "-C" || arg === "-c") {
			index += 2;
			continue;
		}
		if (arg.startsWith("-")) {
			index++;
			continue;
		}
		const check = GIT_SUBCOMMAND_CHECKS[arg];
		return check ? check(args.slice(index + 1)) : GIT_READ_ONLY.has(arg);
	}
	return false;
}

const GIT_SUBCOMMAND_CHECKS: Record<string, (args: string[]) => boolean> = {
	branch: safeGitBranch,
	remote: safeGitRemote,
};

// `git branch` lists for free but creates, deletes, and renames with the same name,
// so only the filter flags pass and a bare word passes only after `--list`.
function safeGitBranch(args: string[]): boolean {
	let lists = false;

	for (let index = 0; index < args.length; index++) {
		const arg = args[index] ?? "";
		if (arg === "-l" || arg === "--list") lists = true;

		const [flag, value] = splitFlag(arg);
		if (GIT_BRANCH_VALUE_FLAGS.has(flag)) {
			if (value === undefined) index++;
			continue;
		}
		if (GIT_BRANCH_OPTIONAL_VALUE_FLAGS.has(flag)) continue;
		if (GIT_BRANCH_FLAGS.has(arg)) continue;
		if (isShortCluster(arg, GIT_BRANCH_SHORT_LETTERS)) continue;
		if (arg.startsWith("-")) return false;
		if (!lists) return false;
	}

	return true;
}

// `git remote` lists or shows by default; every mutation is its own subcommand.
function safeGitRemote(args: string[]): boolean {
	let index = 0;
	while (index < args.length && GIT_REMOTE_FLAGS.has(args[index] ?? "")) index++;
	if (index === args.length) return true;
	return GIT_REMOTE_SUBCOMMANDS.has(args[index] ?? "");
}

function splitFlag(arg: string): [string, string | undefined] {
	const equals = arg.indexOf("=");
	if (equals < 0) return [arg, undefined];
	return [arg.slice(0, equals), arg.slice(equals + 1)];
}

// Bundled shorts such as `-av` are safe only when every letter is.
function isShortCluster(arg: string, letters: Set<string>): boolean {
	if (!/^-[^-]/.test(arg)) return false;
	for (const letter of arg.slice(1)) {
		if (!letters.has(letter)) return false;
	}
	return true;
}

function isOutputFlag(arg: string): boolean {
	return arg === "--output" || arg.startsWith("--output=") || /^-[^-]*o/.test(arg);
}

function isOneOf(arg: string, values: string[]): boolean {
	return values.some((value) => arg === value || arg.startsWith(`${value}=`));
}
