import { describe, expect, test } from "bun:test";

import { isReadOnlyCommand } from "../src/readonly.ts";

/** Runs against an empty environment so the tests never depend on the machine. */
function ro(command: string, env: NodeJS.ProcessEnv = {}): boolean {
	return isReadOnlyCommand(command, env);
}

describe("read-only chains", () => {
	test("allows a chain of known read commands", () => {
		expect(
			ro(
				"cd /repo && sed -n '2305,2360p' node_modules/x/y.js; echo '===' ; cat node_modules/x/y.d.ts",
			),
		).toBe(true);
		expect(ro("cd /repo && wc -l a.js b.js && echo === && cat c.js")).toBe(true);
		expect(ro("cat file | grep x | head -5")).toBe(true);
		expect(ro("ls *.ts")).toBe(true);
		expect(ro("git log --oneline -5 && git status")).toBe(true);
		expect(ro("git -C /repo status")).toBe(true);
	});
});

describe("read-only refusals", () => {
	test("redirection, substitution, and subshells", () => {
		expect(ro("cat > out.ts")).toBe(false);
		expect(ro("echo hi >> log")).toBe(false);
		expect(ro("cat < input")).toBe(false);
		expect(ro("echo $(date)")).toBe(false);
		expect(ro("cat `whoami`")).toBe(false);
		expect(ro("(cat file)")).toBe(false);
	});

	test("multi-line input, because newlines fold into whitespace", () => {
		expect(ro("cat a\nrm -rf /")).toBe(false);
		expect(ro("cd /repo && cat > ./x <<'EOF'\nrm -rf /\nEOF")).toBe(false);
	});

	test("writers and executors", () => {
		for (const command of [
			"rm -rf /tmp/x",
			"mv a b",
			"cp a b",
			"tee out",
			"xargs rm",
			"awk '{print}' file",
			"bun run x",
			"node x.js",
			"PATH=/evil cat file",
			"cd repo && bun ./probe.ts; rm ./probe.ts",
		]) {
			expect(ro(command)).toBe(false);
		}
	});

	test("flag checks", () => {
		expect(ro("sed 's/a/b/g' file")).toBe(true);
		expect(ro("sed -i 's/a/b/' file")).toBe(false);
		expect(ro("sed -n '1e cat /etc/passwd' file")).toBe(false);
		expect(ro("sort file")).toBe(true);
		expect(ro("sort -o out file")).toBe(false);
		expect(ro("sort -uo out file")).toBe(false);
		expect(ro("find . -name '*.ts'")).toBe(true);
		expect(ro("find . -exec rm {} ;")).toBe(false);
		expect(ro("git push")).toBe(false);
		expect(ro("rg --pre 'sh' x")).toBe(false);
		expect(ro("tree -o out")).toBe(false);
		expect(ro("uniq a b")).toBe(false);
		expect(ro("uniq a")).toBe(true);
		expect(ro("date -s '2020-01-01'")).toBe(false);
		expect(ro("date -s2020-01-01")).toBe(false);
		expect(ro("date -u")).toBe(true);
		expect(ro("hostname new-name")).toBe(false);
		expect(ro("[ -f file ]")).toBe(true);
	});

	test("a comment is not a command", () => {
		expect(ro("cat file # rm -rf /")).toBe(true);
	});

	test("an exported function shadows its command", () => {
		const env = { "BASH_FUNC_cat%%": "() { rm -rf /; }" };
		expect(ro("cat file", env)).toBe(false);
		expect(ro("ls", env)).toBe(true);
	});

	test("BASH_ENV disables the check, because it can define functions", () => {
		expect(ro("cat file", { BASH_ENV: "/tmp/startup.sh" })).toBe(false);
	});
});
