import { describe, expect, test } from "bun:test";

import { isReadOnlyCommand } from "#core/readonly-bash.ts";

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
		expect(ro("git branch")).toBe(true);
		expect(ro("git branch --show-current")).toBe(true);
		expect(ro("git branch -a")).toBe(true);
		expect(ro("git branch -vv --list 'feat*'")).toBe(true);
		expect(ro("git branch --sort=-committerdate --format='%(refname)'")).toBe(true);
		expect(ro("git remote")).toBe(true);
		expect(ro("git remote show origin")).toBe(true);
		expect(ro("git remote get-url origin")).toBe(true);
		expect(
			ro(
				"cd /repo && git branch --show-current && git status --short | head -5 && git log --oneline -3 && git branch -a | head -10 && git remote -v | head -2",
			),
		).toBe(true);
	});

	test("allows redirects that only discard output", () => {
		expect(ro("git show HEAD:x.py 2>/dev/null | head -5; git diff main...x -- a.py")).toBe(true);
		expect(ro("ls -la tests 2>&1 | tail -3")).toBe(true);
		expect(ro("git log > /dev/null && git status")).toBe(true);
		expect(ro("ls -la &>/dev/null")).toBe(true);
		expect(ro("cat file < /dev/null")).toBe(true);
	});

	test("allows sed address ranges that only print or delete", () => {
		expect(ro("sed -n '/^## Work/,/^Infra/p' PLAN.md")).toBe(true);
		expect(ro("sed -n '10,20p' file")).toBe(true);
		expect(ro("sed '1,3d' file")).toBe(true);
	});

	test("allows a loop over a literal word list", () => {
		expect(ro(`for f in a.tsx b.tsx; do echo "=== $f ==="; cat "$f"; done`)).toBe(true);
		expect(ro(`for f in *.ts; do cat "$f"; done`)).toBe(true);
		expect(ro(`for a in x; do for b in y; do wc -l "$b"; done; done`)).toBe(true);
		expect(ro(`for f in do; do cat "$f"; done`)).toBe(true);
	});

	test("a loop spreads over lines", () => {
		expect(
			ro(`cd /repo && for f in\n a.tsx b.tsx\n c.tsx; do\n echo "===== $f ====="; cat "$f"; done`),
		).toBe(true);
	});

	test("a bare newline separates commands", () => {
		expect(ro("cd /repo\ncat a.tsx")).toBe(true);
		expect(ro("cat a.tsx\nhead -n 5 b.tsx")).toBe(true);
	});

	test("treats backticks and $() inside single quotes as literal", () => {
		expect(ro("grep -n '^`x`' file")).toBe(true);
		expect(ro("echo '$(date)'")).toBe(true);
	});
});

describe("read-only refusals", () => {
	test("redirection, substitution, and subshells", () => {
		expect(ro("cat > out.ts")).toBe(false);
		expect(ro("echo hi >> log")).toBe(false);
		expect(ro("cat < input")).toBe(false);
		expect(ro("echo $(date)")).toBe(false);
		expect(ro('echo "$(date)"')).toBe(false);
		expect(ro("cat `whoami`")).toBe(false);
		expect(ro('echo "`date`"')).toBe(false);
		expect(ro("(cat file)")).toBe(false);
	});

	test("redirects to real files are writes", () => {
		expect(ro("git show HEAD:x 2>/tmp/err.log")).toBe(false);
		expect(ro("ls 2>> out")).toBe(false);
		expect(ro("ls 2>/dev/null && rm -rf /tmp/x")).toBe(false);
		expect(ro("uniq a b 2>/dev/null")).toBe(false);
	});

	test("multi-line input, because a newline is a separator and not whitespace", () => {
		expect(ro("cat a\nrm -rf /")).toBe(false);
		expect(ro("echo in\nrm -rf /")).toBe(false);
		expect(ro("cd /repo && cat > ./x <<'EOF'\nrm -rf /\nEOF")).toBe(false);
	});

	test("a comment never swallows the next line", () => {
		expect(ro("cat a # rm -rf /\nrm -rf /")).toBe(false);
		expect(ro("cat a#b\ncat c")).toBe(true);
	});

	test("a loop that hides a write, a flag, or a body", () => {
		expect(ro(`for f in a; do rm -rf /; done`)).toBe(false);
		expect(ro(`for f in a; do sed -i file; done`)).toBe(false);
		expect(ro(`for f in -i; do sed $f file; done`)).toBe(false);
		expect(ro(`for f in "rm -rf /"; do cat "$f"; done`)).toBe(false);
		expect(ro(`for f in a b; do cat "$f"; echo x > /tmp/out; done`)).toBe(false);
		expect(ro(`for f in a; do cat "$f"; done && rm -rf /`)).toBe(false);
	});

	test("a loop that cannot be read still checks its body", () => {
		expect(ro(`for f in; do rm -rf /; done`)).toBe(false);
		expect(ro(`for f in do; do rm -rf /; done`)).toBe(false);
		expect(ro(`for f; do cat "$f"; done`)).toBe(false);
		expect(ro(`for f in a; do cat "$f"`)).toBe(false);
		expect(ro(`for f in "$@"; do cat "$f"; done`)).toBe(false);
		expect(ro(`for f in a; do $f; done`)).toBe(false);
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
		expect(ro("git branch new-branch")).toBe(false);
		expect(ro("git branch -d old")).toBe(false);
		expect(ro("git branch -avD old")).toBe(false);
		expect(ro("git branch --color foo")).toBe(false);
		expect(ro("git branch --column foo")).toBe(false);
		expect(ro("git branch --abbrev 7")).toBe(false);
		expect(ro("git branch --list --color=always foo")).toBe(true);
		expect(ro("git branch -m old new")).toBe(false);
		expect(ro("git branch --edit-description")).toBe(false);
		expect(ro("git remote add origin url")).toBe(false);
		expect(ro("git remote set-url origin url")).toBe(false);
		expect(ro("git remote prune origin")).toBe(false);
		expect(ro("git remote update")).toBe(false);
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

describe("read-only attacks", () => {
	const manyWords = `for f in ${Array.from({ length: 200 }, () => "a").join(" ")}; do cat "$f"; done`;

	test("a forged flag, name, or word list stays out", () => {
		for (const command of [
			// A reference the classifier cannot read cannot be trusted with a dash.
			`for f in o; do sort -"$f" out file; done`,
			`for f in a; do sort --output="$f" out file; done`,
			`sort -"$UNSET" out file`,
			// The literal `cat` must not become `cat$f` at run time.
			`for f in x; do "cat$f" file; done`,
			`for f in x; do "\${f}cat" file; done`,
			// The word list is literal, or the loop reads nothing.
			`for f in "$@"; do sort "$f" out file; done`,
			`for f in "$HOME"; do cat "$f"; done`,
			`for f in a"$b"; do cat "$f"; done`,
			`for f in -i; do sed $f file; done`,
			`for f in --pre; do rg "$f" x; done`,
			`for f in --output=out; do sort "$f" file; done`,
			`for f in -rf; do rm "$f"; done`,
			`for f in "a b"; do cat "$f"; done`,
			`for f in "rm -rf /"; do cat "$f"; done`,
			`for f in a=b; do cat "$f"; done`,
			// A body that reads is the only body that runs.
			`for f in a; do rm -rf /; done`,
			`for f in a; do sed -i file; done`,
			`for f in a; do cat "$f"; echo x > /tmp/out; done`,
			`for f in a; do cat "$f"; tee out; done`,
			`for f in a; do cat "$f" | sh; done`,
			`for f in a; do xargs rm; done`,
			`for f in a; do eval "$f"; done`,
			`for f in rm; do $f -rf /; done`,
			`for f in a; do IFS=, cat "$f"; done`,
			`for f in a; do cat "$f" < input; done`,
			`for f in a; do $(rm -rf /); done`,
			"for f in a; do cat `cat`; done",
			// Loop syntax the reader cannot pin down fails closed.
			`for f in; do rm -rf /; done`,
			`for f in do; do rm -rf /; done`,
			`for f; do cat "$f"; done`,
			`for $f in a; do cat "$f"; done`,
			`for f in a; do cat "$f"`,
			`for f in a; do cat "$f"; done; done`,
			`for f in a b; do cat "$f"; done && rm -rf /`,
			`for f in a; do cat "$f"; done || rm -rf /`,
			`for f in a; do cat "$f"; done > /tmp/out`,
			manyWords,
			`for a in x; do for b in x; do for c in x; do for d in x; do for e in x; do cat a; done; done; done; done; done`,
			// A newline and a comment cannot hide the second command.
			`cat a\nrm -rf /`,
			`echo in\nrm -rf /`,
			`cat a # rm -rf /\nrm -rf /`,
			`cat a\r\nrm -rf /`,
			`cat "a`,
		]) {
			expect(ro(command)).toBe(false);
		}
	});

	test("the reads that should still pass do", () => {
		for (const command of [
			`for f in a; do cat "$f"; done`,
			`for f in a; do cat $f; done`,
			`for f in *.ts; do head -n 5 "$f"; done`,
			`for f in a b; do echo "== $f =="; cat "$f"; head -n 2 "$f"; done`,
			`for a in x; do for b in y; do wc -l "$b"; done; done`,
			`cd /repo && for f in a b; do cat "$f"; done > /dev/null`,
			`for f in a; do cat "$f" | head -1; done`,
			`for f in a; do cat a; done`,
			`cat a#b\ncat c`,
			`cat '$f'`,
			`echo "a\nb"`,
		]) {
			expect(ro(command)).toBe(true);
		}
	});
});
