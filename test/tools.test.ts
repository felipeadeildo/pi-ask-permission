import { describe, expect, test } from "bun:test";

import {
	asToolInput,
	type CallDescriptor,
	commandLevels,
	createToolRegistry,
	pathLevels,
	shortenHome,
	tokenize,
} from "#core/tools.ts";

function describeCall(toolName: string, input: unknown): CallDescriptor {
	return createToolRegistry().get(toolName).describe(asToolInput(input));
}

describe("commandLevels", () => {
	test("nests a command from head to exact", () => {
		expect(commandLevels("git status --short")).toEqual([
			"git",
			"git status",
			"git status --short",
		]);
	});

	test("a bare command has one level", () => {
		expect(commandLevels("ls")).toEqual(["ls"]);
	});

	test("a leading assignment is skipped for the coarse levels", () => {
		expect(commandLevels("FOO=1 git push")).toEqual(["git", "git push", "FOO=1 git push"]);
	});

	test("quotes are preserved in the exact level", () => {
		expect(commandLevels('git commit -m "a b"')).toEqual([
			"git",
			"git commit",
			'git commit -m "a b"',
		]);
	});

	test("an empty command still yields a level", () => {
		expect(commandLevels("   ")).toEqual(["(empty command)"]);
	});

	test("quoted whitespace does not split the head", () => {
		expect(commandLevels("'my tool' run")[0]).toBe("my tool");
	});
});

describe("pathLevels", () => {
	test("relative path nests by directory then file", () => {
		expect(pathLevels("src/foo/bar.ts")).toEqual(["src/foo", "src/foo/bar.ts"]);
	});

	test("home is shortened", () => {
		expect(pathLevels(`${process.env.HOME}/.ssh/config`)).toEqual(["~/.ssh", "~/.ssh/config"]);
	});

	test("the filesystem root is its own level", () => {
		expect(pathLevels("/")).toEqual(["/"]);
	});

	test("a bare filename has one level", () => {
		expect(pathLevels("id_rsa")).toEqual(["id_rsa"]);
	});

	test("an absolute path keeps its directory", () => {
		expect(pathLevels("/etc/passwd")).toEqual(["/etc", "/etc/passwd"]);
	});
});

describe("tokenize", () => {
	test("respects quotes and escapes", () => {
		expect(tokenize(`a 'b c' "d e" f\\ g`)).toEqual(["a", "b c", "d e", "f g"]);
	});

	test("an unterminated quote consumes the rest", () => {
		expect(tokenize(`echo "unterminated`)).toEqual(["echo", "unterminated"]);
	});
});

describe("describe", () => {
	test("bash uses the command", () => {
		expect(describeCall("bash", { command: "sudo rm -rf /tmp/x" })).toEqual({
			summary: "sudo rm -rf /tmp/x",
			grantLevels: ["sudo", "sudo rm", "sudo rm -rf /tmp/x"],
		});
	});

	test("file tools use the path", () => {
		expect(describeCall("write", { path: "src/a.ts" }).grantLevels).toEqual(["src", "src/a.ts"]);
	});

	test("mcp nests server then tool", () => {
		expect(describeCall("mcp", { server: "github", tool: "search_code" })).toEqual({
			summary: "github:search_code",
			grantLevels: ["github", "github:search_code"],
		});
	});

	test("an unknown tool has one level: its name", () => {
		expect(describeCall("todo", { items: [1] }).grantLevels).toEqual(["todo"]);
	});

	test("a missing input does not throw", () => {
		expect(describeCall("bash", undefined).grantLevels).toEqual(["(empty command)"]);
	});
});

describe("shortenHome", () => {
	test("leaves other paths alone", () => {
		expect(shortenHome("/etc/passwd")).toBe("/etc/passwd");
	});
});

describe("tool adapters", () => {
	test("edit and write are edits, bash is not", () => {
		const tools = createToolRegistry();
		expect(tools.get("edit").edits).toBe(true);
		expect(tools.get("write").edits).toBe(true);
		expect(tools.get("bash").edits).toBeUndefined();
	});

	test("powershell paths cannot be read, so every call counts as outside", () => {
		expect(createToolRegistry().get("powershell").paths({ command: "ls" })).toBeUndefined();
	});

	test("an unknown tool has no paths", () => {
		expect(
			createToolRegistry()
				.get("todo")
				.paths({ items: [1] }),
		).toEqual([]);
	});

	test("a registered adapter replaces the built-in until it is removed", () => {
		const tools = createToolRegistry();
		const remove = tools.register("todo", {
			describe: () => ({ summary: "todo", grantLevels: ["todo"] }),
			paths: () => undefined,
			edits: true,
		});

		expect(tools.get("todo").edits).toBe(true);
		remove();
		expect(tools.get("todo").edits).toBeUndefined();
	});
});
