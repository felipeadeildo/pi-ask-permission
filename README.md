# pi-ask-permission

[![CI](https://github.com/felipeadeildo/pi-ask-permission/actions/workflows/ci.yml/badge.svg)](https://github.com/felipeadeildo/pi-ask-permission/actions/workflows/ci.yml)

A permission dialog for the [Pi](https://pi.dev) coding agent. It stops before a tool runs, remembers what you said, and carries a reason back to the agent when you have one.

```
permission · bash
  git push origin main

❯ 1  yes
  2  always yes
  3  deny

↑↓ or 1-3 pick   enter confirm   tab note   esc deny
```

## Why this exists

Every permission prompt I used gave me two buttons.

Say the agent runs `npm install` and you wanted pnpm. Pressing yes runs npm. Pressing no leaves the agent guessing at why, so you type an explanation in a follow-up message, and it lands a turn late, detached from the decision it belongs to. Neither button has room for "no, use pnpm instead".

So each row has a third option. Press `tab` and the row grows an input:

```
permission · bash
  npm install

  1  yes
  2  always yes
❯ 3  deny, use pnpm instead

↑↓ pick   enter confirm   esc back
```

The agent reads the reason while it is still working, which is the difference between being corrected and being restarted.

The same key works on an approval, for what you want to add rather than take back:

```
permission · write
  package.json

❯ 1  yes, keep the existing version ranges
  2  always yes
  3  deny

↑↓ pick   enter confirm   esc back
```

The note rides along with the result, so the agent has it before it plans its next step.

While the input is open, `↑` and `↓` still move the highlight and take the editor with them. Each row keeps its own draft, so a note you typed stays on its row after you look at another option.

## Always yes asks two questions

The first is how wide the grant is. The choices come from the call in front of you:

```
permission · bash
  pnpm test

always yes for...
  pnpm
❯ pnpm test

scope: this session   (tab to change)

↑↓ depth   tab scope   enter confirm   esc back
```

The narrowest option is preselected, so `enter` grants exactly what you were looking at. Arrow up for the wider one. File tools nest by directory instead of by argument, so a write can be approved for one file or for the folder around it.

The second question is how long it lasts. The picker opens on the narrowest, and `tab` cycles through the three scopes:

| Scope        | Stored in                                                | Survives                 |
| ------------ | -------------------------------------------------------- | ------------------------ |
| this session | memory                                                   | nothing                  |
| this project | `<project>/.pi/extensions/pi-ask-permission/grants.json` | reloads and new sessions |
| everywhere   | `~/.pi/agent/extensions/pi-ask-permission/grants.json`   | everything               |

A grants file is plain JSON you can read and edit:

```json
{
	"bash": ["pnpm test"],
	"write": ["~/dev/my-project/src"]
}
```

Grants are matched by tool name and level, so a `bash` grant never widens `write`.

Project grants load only in a trusted project. A repository must not be able to ship a grants file that widens its own permissions, so the project file is ignored until you trust the project, and the extension says so when it skips one.

## Install

```bash
pi install npm:pi-ask-permission
```

Or straight from the repository:

```bash
pi install git:github.com/felipeadeildo/pi-ask-permission
```

Or clone it anywhere and point `~/.pi/agent/settings.json` at `src/index.ts`. There is an example at the bottom of this file.

## Keys

| Key                    | Does                                                                    |
| ---------------------- | ----------------------------------------------------------------------- |
| `↑` `↓` or `1` `2` `3` | move the highlight, and the open note input with it                     |
| `enter`                | confirm the highlighted row                                             |
| `tab`                  | open or close the note input, and in the depth picker, change the scope |
| `esc`                  | deny, or close the note input if one is open                            |

Digits move the highlight rather than deciding, which keeps the grammar small. Pick a row, then confirm it or attach a note to it. It also means a denial can carry a reason without needing a key of its own. The highlight starts on `yes`, so a plain approval is still one `enter`.

## Configuration

One file, four keys. It is created with the defaults the first time the extension loads.

```
~/.pi/agent/extensions/pi-ask-permission/config.json
```

`PI_CODING_AGENT_DIR` moves it along with the rest of the agent directory.

```json
{
	"allow": ["read", "grep", "find", "ls"],
	"headless": "deny",
	"followup": "result",
	"yolo": false
}
```

**`allow`** lists the tools that never prompt. Everything else asks, including tools from extensions and MCP servers that register later. Wildcards work, so one entry can cover a family:

```json
{
	"allow": ["read", "grep", "find", "ls", "mcp_*"]
}
```

**`headless`** decides what happens with nobody to ask: print mode, JSON mode, or a subagent. The default denies, so a scripted run cannot quietly do gated work.

```json
{
	"headless": { "*": "allow", "bash": "deny" }
}
```

That runs everything unattended except bash. Specificity wins over file order, so an exact tool name beats a wildcard and a wildcard beats `*`.

**`followup`** chooses where a note attached to an approval goes. `"result"` appends it to the tool result the model is already reading. `"message"` sends it as a separate steering message, which shows up in the transcript on its own line.

**`yolo`** approves everything without asking. It is there for a throwaway run, not for a working session.

If the file is missing, unreadable, or wrong, the extension falls back to the defaults and tells you what it dropped. A typo never widens the gate.

## Commands

| Command               | Does                                                                      |
| --------------------- | ------------------------------------------------------------------------- |
| `/perm`               | open a settings dialog for `followup`, `headless`, and `yolo`             |
| `/perm status`        | print the resolved config, the grant counts per scope, and the file paths |
| `/perm reset`         | forget this session's grants                                              |
| `/perm reset project` | delete the project grants file                                            |
| `/perm reset global`  | delete the global grants file                                             |
| `/perm reset all`     | clear all three scopes                                                    |

## How a call is decided

1. `yolo` is on, allow.
2. The tool is in `allow`, allow.
3. A grant matches this tool and level, allow.
4. There is a UI, ask.
5. There is no UI, `headless` decides. The default denies.

## What it does not do

It is a dialog, not a policy language. There is no wildcard rule engine, no path canonicalization, and no symlink resolution. A command arrives as the agent wrote it and gets judged by the person reading it.

Two consequences worth knowing before you rely on it.

A chained command is one string. `cd /repo && pnpm test` nests as `cd`, `cd /repo`, and the whole chain, because the depth picker reads the text rather than parsing the shell. Grants on chains are coarse at the head and exact at the tail.

`allow` matches a tool name, not an argument. Adding `bash` to `allow` permits every bash command, which is what the `bash` row of the dialog is for.

If you want deterministic rules enforced with no human in the loop, this is the wrong tool. If you want to be asked, once, in as few keystrokes as possible, it is the right one.

## Development

Requires [Bun](https://bun.sh).

```bash
bun install        # also installs the Lefthook git hooks

bun run check      # tsc --noEmit
bun run lint       # oxlint
bun run fmt        # oxfmt (writes)
bun run fmt:check  # oxfmt --check
bun run test       # bun test

bun run verify     # all of the above
```

[Lefthook](lefthook.yml) formats and lints staged files on commit, type-checks the project, and runs the full verify before a push. `bun install` installs the hooks, and `bunx lefthook install` reinstalls them by hand.

To run a checkout without installing it, add the entry point to `~/.pi/agent/settings.json`:

```json
{
	"extensions": ["/path/to/pi-ask-permission/src/index.ts"]
}
```

## License

[MIT](LICENSE) © Felipe Adeildo
