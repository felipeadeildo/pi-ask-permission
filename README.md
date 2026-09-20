# pi-ask-permission

[![CI](https://github.com/felipeadeildo/pi-ask-permission/actions/workflows/ci.yml/badge.svg)](https://github.com/felipeadeildo/pi-ask-permission/actions/workflows/ci.yml)

A permission dialog for the [Pi](https://pi.dev) coding agent. Three answers, each with room for a note that reaches the agent with the decision.

```
permission · bash
  git push origin main

❯ 1  yes
  2  always yes
  3  deny

↑↓ or 1-3 pick   enter confirm   tab note   esc deny
```

If you are mid-sentence in the editor when a call arrives, the dialog waits for you to pause. The footer reads `waiting for you to finish typing` while it does, and by default it waits however long that takes. Set `typing.maxWait` to cap it.

## Why

Two-button prompts only say yes or no. Say the agent runs `npm install` and you wanted pnpm. Pressing yes runs the wrong command. Pressing no leaves the agent guessing why, so the explanation arrives a turn late and detached from the decision.

Press `tab` and the highlighted row grows an input:

```
permission · bash
  npm install

  1  yes
  2  always yes
❯ 3  deny, use pnpm instead

↑↓ pick   enter confirm   esc back
```

The note rides along with the tool result, so the agent reads "use pnpm instead" while it is still working. The same works on an approval, for what you want to add. Arrow keys keep moving the highlight with the input attached, and each row keeps its own draft.

Paste works like the main editor. `ctrl+v` drops in a clipboard image as its temp file path, and a long or multi-line paste collapses to a `[paste #1 +48 lines]` marker that expands when you confirm.

## Always yes asks two questions

How wide the grant is, then how long it lasts.

```
permission · bash
  pnpm test

always yes for...
  pnpm
❯ pnpm test

scope: this session   (tab to change)
```

The narrowest level is preselected, so `enter` grants exactly what you were looking at. File tools nest by directory, so a write can be approved for one file or the folder around it.

`tab` cycles the scope:

| Scope        | Stored in                                                | Survives                 |
| ------------ | -------------------------------------------------------- | ------------------------ |
| this session | memory                                                   | nothing                  |
| this project | `<project>/.pi/extensions/pi-ask-permission/grants.json` | reloads and new sessions |
| everywhere   | `~/.pi/agent/extensions/pi-ask-permission/grants.json`   | everything               |

The files are plain JSON, `{ "bash": ["pnpm test"] }`, and grants are matched by tool and level, so a `bash` grant never widens `write`. Project grants load only in a trusted project, so a repository cannot ship a grants file that widens its own permissions.

## Install

```bash
pi install npm:pi-ask-permission
```

Or `pi install git:github.com/felipeadeildo/pi-ask-permission`, or clone it and point `~/.pi/agent/settings.json` at `src/index.ts`.

## Keys

| Key                    | Does                                                                    |
| ---------------------- | ----------------------------------------------------------------------- |
| `↑` `↓` or `1` `2` `3` | move the highlight, and the open note input with it                     |
| `enter`                | confirm the highlighted row                                             |
| `tab`                  | open or close the note input, and in the depth picker, change the scope |
| `esc`                  | deny, or close the note input if one is open                            |

Digits only move the highlight, so any row can take a note or a plain confirm. The highlight starts on `yes`, so a plain approval is one `enter`.

## Configuration

One file, created with these defaults on first load. `PI_CODING_AGENT_DIR` moves it with the rest of the agent directory.

```
~/.pi/agent/extensions/pi-ask-permission/config.json
```

```json
{
	"allow": ["read", "grep", "find", "ls"],
	"headless": "deny",
	"followup": "result",
	"yolo": false,
	"typing": { "pause": 1000, "maxWait": null }
}
```

`allow` lists the tools that never prompt. Wildcards work, so `mcp_*` covers a family. Everything else asks, including tools registered later.

`headless` decides when there is nobody to ask: print mode, JSON mode, or a subagent. It takes one mode or a per-tool map. Specificity wins over file order, so an exact name beats a wildcard and a wildcard beats `*`.

```json
{
	"headless": { "*": "allow", "bash": "deny" }
}
```

`followup` chooses where an approval note goes. `"result"` appends it to the tool result the model is already reading. `"message"` sends it as its own steering message. `yolo` approves everything, for a throwaway run.

`typing` tunes that wait. `pause` is the quiet time in milliseconds before the dialog opens. `maxWait` caps the total wait in milliseconds, or `null` for no cap.

A missing or malformed file falls back to the defaults and reports what it dropped. A typo never widens the gate.

## Commands

| Command               | Does                                                    |
| --------------------- | ------------------------------------------------------- |
| `/perm`               | settings dialog for `followup`, `headless`, and `yolo`  |
| `/perm status`        | resolved config, grant counts per scope, and file paths |
| `/perm reset`         | forget this session's grants                            |
| `/perm reset project` | delete the project grants file                          |
| `/perm reset global`  | delete the global grants file                           |
| `/perm reset all`     | clear all three scopes                                  |

## How a call is decided

1. `yolo` is on, allow.
2. The tool is in `allow`, allow.
3. A grant matches this tool and level, allow.
4. There is a UI, ask.[^edit]
5. There is no UI, `headless` decides. The default denies.

[^edit]: An `edit` whose `oldText` cannot match the file is blocked with the matcher's own error, no dialog. Asking about an edit that is already going to fail only costs a keystroke.

## Limits

It is a dialog, not a policy language. No wildcard rules, no path canonicalization, no symlink resolution. A command arrives as the agent wrote it and is judged by the person reading it.

A chained command is one string. `cd /repo && pnpm test` offers `cd`, `cd /repo`, and the whole chain, because the depth picker reads text rather than parsing the shell. Grants on chains are coarse at the head and exact at the tail.

`allow` matches a tool name, not an argument, so allowing `bash` permits every bash command.

If you want deterministic rules with no human in the loop, this is the wrong tool.

## Development

Requires [Bun](https://bun.sh). `bun install` also installs the Lefthook hooks.

```bash
bun run check      # tsc --noEmit
bun run lint       # oxlint
bun run fmt        # oxfmt (writes)
bun run test       # bun test
bun run verify     # all of the above
```

[Lefthook](lefthook.yml) formats and lints staged files on commit, type-checks the project, and runs the full verify before a push.

## Releasing

Commits follow [Conventional Commits](https://www.conventionalcommits.org). [release-please](https://github.com/googleapis/release-please) keeps a release PR with the changelog and the version bump. Merging it tags the release, and the same workflow publishes to npm. Auth is [trusted publishing](https://docs.npmjs.com/trusted-publishers/) over OIDC, so there is no `NPM_TOKEN` secret.

## License

[MIT](LICENSE) © Felipe Adeildo
