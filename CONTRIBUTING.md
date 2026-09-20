# Contributing

## Setup

Requires [Bun](https://bun.sh). `bun install` also installs the Lefthook hooks.

```bash
bun run check      # tsc --noEmit
bun run lint       # oxlint
bun run fmt        # oxfmt (writes)
bun run test       # bun test
bun run verify     # all of the above
```

Lefthook formats and lints staged files on commit, type-checks the project, and runs the full verify before a push.

## Layout

```text
src/
  index.ts      # wiring only
  pi/           # pi boundary: events, commands, provider, session
  core/         # policy and judging, no pi and no TUI
    config/     # schema, decode, store, patterns
    judge/      # pipeline, compose, request, policy, backends
  ui/           # TUI: dialog, selector, settings, judge entry
  util/         # decoders and primitives
```

`core/` never imports `pi/` or `ui/`. The permission pipeline is in `pi/events.ts`, the judging pipeline in `core/judge`.

All untrusted input (config, grants, model answers) goes through `util/decode.ts`, the only module that inspects `typeof`. Decoders return a value or a list of problems, and never throw.

## Imports

Use `#core`, `#ui`, `#pi`, `#util`, and `#identity`, declared in `package.json` `imports`. They resolve in tsc, Bun, and pi's jiti loader, so moving a file does not rewrite relative paths. tsconfig `paths` only works while pi runs from source, so it is not used.

## Adding a config key

1. Add the type and the default in `core/config/schema.ts`.
2. Add a decoder in `core/config/decode.ts`. A missing key takes the default; a present but invalid key takes the default and reports a warning.
3. Add a test in `test/config.test.ts`.

## Open ideas

The judge sees one call, the policy, and the project root. It does not see the session goal. Sending a short goal summary would make the verdict more accurate. The last user message alone was a poor source, often just "continue", and gating on it escalated most calls. A summary assembled from the session would fix the signal without the false positives.

## Commit and release

Commits follow [Conventional Commits](https://www.conventionalcommits.org). [release-please](https://github.com/googleapis/release-please) keeps a release PR with the changelog and the version bump. Merging it tags the release, and the same workflow publishes to npm. Auth is [trusted publishing](https://docs.npmjs.com/trusted-publishers/) over OIDC, so there is no `NPM_TOKEN` secret.
