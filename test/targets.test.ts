import { describe, expect, test } from "bun:test";

import { commandLevels, deriveTarget, pathLevels, shortenHome, tokenize } from "#core/target.ts";

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

describe("deriveTarget", () => {
	test("bash uses the command", () => {
		expect(deriveTarget("bash", { command: "sudo rm -rf /tmp/x" })).toEqual({
			summary: "sudo rm -rf /tmp/x",
			levels: ["sudo", "sudo rm", "sudo rm -rf /tmp/x"],
		});
	});

	test("file tools use the path", () => {
		expect(deriveTarget("write", { path: "src/a.ts" }).levels).toEqual(["src", "src/a.ts"]);
	});

	test("mcp nests server then tool", () => {
		expect(deriveTarget("mcp", { server: "github", tool: "search_code" })).toEqual({
			summary: "github:search_code",
			levels: ["github", "github:search_code"],
		});
	});

	test("an unknown tool has one level: its name", () => {
		expect(deriveTarget("todo", { items: [1] }).levels).toEqual(["todo"]);
	});

	test("a missing input does not throw", () => {
		expect(deriveTarget("bash", undefined).levels).toEqual(["(empty command)"]);
	});
});

describe("shortenHome", () => {
	test("leaves other paths alone", () => {
		expect(shortenHome("/etc/passwd")).toBe("/etc/passwd");
	});
});
