# pi-ask-permission

[![CI](https://github.com/felipeadeildo/pi-ask-permission/actions/workflows/ci.yml/badge.svg)](https://github.com/felipeadeildo/pi-ask-permission/actions/workflows/ci.yml)

A permission dialog for the [Pi](https://pi.dev) coding agent. It asks before a tool runs, remembers the answer, and can carry a reason back to the agent.

```text
permission · bash
  rm -rf build

❯ 1  yes
  2  always yes
  3  deny

↑↓ or 1-3 pick   enter confirm   tab note   esc deny
```

## Why this exists

I got tired of permission prompts that only offer yes and no.

Say the agent runs `npm install` and you wanted pnpm. Pressing yes runs npm. Pressing no leaves the agent guessing, so you type a follow-up message explaining yourself, and the correction lands one turn late with a failed install in between. Neither button has room for "yes, but use pnpm instead".

So every row here has a third option. Press `tab` and the row grows an input:

```text
permission · bash
  npm install

❯ 1  yes, use pnpm instead
  2  always yes
  3  deny

enter confirm   esc back
```

The same works on a refusal:

```text
permission · bash
  rm -rf build

  1  yes
  2  always yes
❯ 3  deny, that deletes the only copy

enter confirm   esc back
```

The agent reads the reason instead of guessing at it, while it is still in the loop.

## Always yes asks how wide

Most prompts treat always-allow as one thing, and it always means more than you wanted. You approve `git status` once, and an hour later `git push --force` walks through the same grant.

Here, always yes asks a second question, and the choices come from the command in front of you:

```text
permission · bash
  git status --short

always yes for...
  git
  git status
❯ git status --short

↑↓ choose depth   enter confirm   esc back
```

The narrowest option is preselected, so `enter` grants exactly the command you were looking at. Arrow up for the wider grant. File tools nest by directory instead of by argument, so a write can be approved for one file or for everything beside it.

Grants last for the session. A reload, a new session, or a restart clears them.

## Install

```bash
pi install git:github.com/felipeadeildo/pi-ask-permission
```

Or clone the repo anywhere and point `~/.pi/agent/settings.json` at `src/index.ts`. There is an example at the bottom of this file.

## Keys

| Key                    | Does                                                |
| ---------------------- | --------------------------------------------------- |
| `↑` `↓` or `1` `2` `3` | move the highlight                                  |
| `enter`                | confirm the highlighted row                         |
| `tab`                  | open or close the note input on the highlighted row |
| `esc`                  | deny, or close the note input if one is open        |

Digits move the highlight rather than deciding, which keeps the grammar small. Pick a row, then confirm it or attach a note to it. It also means a denial can carry a reason without needing its own key. The highlight starts on `yes`, so a plain approval is still one `enter`.

## Configuration

One file, four keys. It is created with the defaults the first time the extension loads.

```text
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

| Key        | Default                       | Meaning                                                                                                                                             |
| ---------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `allow`    | `["read","grep","find","ls"]` | Tools that never prompt. Everything else asks. Wildcards work, so `"mcp_*"` covers a whole family.                                                  |
| `headless` | `"deny"`                      | What to do when there is nobody to ask, in print or JSON mode, or inside a subagent. `"deny"` fails closed.                                         |
| `followup` | `"result"`                    | Where an approval note goes. `"result"` appends it to the tool result the model already reads. `"message"` sends it as a separate steering message. |
| `yolo`     | `false`                       | Approve everything without asking.                                                                                                                  |

`headless` also takes a per-tool map. Specificity wins regardless of the order you write it in, so an exact tool name beats a wildcard and a wildcard beats `*`:

```json
{
	"headless": {
		"*": "allow",
		"bash": "deny"
	}
}
```

That lets a scripted run work unattended while bash still stops.

If the file is missing, unreadable, or wrong, the extension falls back to the defaults and tells you what it dropped. A typo never widens the gate.

## Commands

| Command        | Does                                                              |
| -------------- | ----------------------------------------------------------------- |
| `/perm`        | open a settings dialog for `followup`, `headless`, and `yolo`     |
| `/perm status` | print the resolved config, its path, and how many grants are live |
| `/perm reset`  | forget this session's always-yes grants                           |

## How a call is decided

1. `yolo` is on, allow.
2. The tool is in `allow`, allow.
3. Some level of this call was already granted, allow.
4. There is a UI, ask.
5. There is no UI, `headless` decides. The default denies.

## What it does not do

It is a dialog, not a policy language. There is no wildcard rule engine, no path canonicalization, no symlink resolution, and no pattern precedence. A command arrives as the agent wrote it and gets judged by the person reading it.

If you want deterministic rules enforced without a human in the loop, this is the wrong tool. If you want to be asked, once, in as few keystrokes as possible, it is the right one.

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
