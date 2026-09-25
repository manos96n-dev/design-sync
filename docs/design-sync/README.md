---
title: Quick start
description: Install Design Sync, connect a Figma file, and inspect your first synchronization status.
---

# Design Sync quick start

Design Sync tracks explicit relationships between Figma nodes and code files. Use the human output for daily work and the JSON output for agents or automation.

## Before you start

You need:

- Node.js 22.12 or newer and a project `package.json`.
- A Figma personal access token with `file_content:read` access to the file.
- One Figma file URL and one or more page or section URLs that define the discovery scope.
- The URL of a hosted Design Sync registry artifact.

A Figma URL such as:

```text
https://www.figma.com/design/FIGMA_FILE_KEY/Example?node-id=123-456
```

contains:

- file key: `FIGMA_FILE_KEY`
- node ID: `123:456`

Pass only those values to the CLI. Do not paste a Markdown link or the entire Figma URL into `--file` or `--tracking-roots`.

## 1. Install

Run from the repository root. In a monorepo, use the workspace root.

```sh
npx shadcn@latest add https://registry.manosnits.com/r/design-sync.json
```

The registry adds `tools/design-sync/`, `docs/design-sync/`, and pinned development dependencies. It does not replace application configuration or project state.

## 2. Configure credentials

For local use, copy the token template and edit the private file:

```sh
cp tools/design-sync/.env.example tools/design-sync/.env
```

```dotenv
FIGMA_ACCESS_TOKEN=figd_your_token_here
```

The lookup order is the exported process environment, repository-root `.env`, then `tools/design-sync/.env`. Existing exported values win. Keep the token out of Git, terminal history, command arguments, and chat. CI should use its secret store.

Confirm the private file is ignored:

```sh
git check-ignore tools/design-sync/.env
```

If that prints nothing, add `/tools/design-sync/.env` to the repository's `.gitignore` before continuing.

## 3. Initialize tracking

```sh
pnpm exec tsx tools/design-sync/cli.ts init \
  --file 'FIGMA_FILE_KEY' \
  --tracking-roots '123:456'
```

Use comma-separated canonical IDs for multiple roots. A page or section root is a discovery container; Design Sync tracks the outermost supported frames/components beneath it. Empty roots never mean the entire file.

Initialization creates `.design-sync/` and adds missing `design:*` scripts. It preserves conflicting scripts and reports the exact manual command to use.

## 4. Scan and inspect

```sh
pnpm design:scan
pnpm design:status
```

`scan` contacts Figma and atomically replaces the cached observation after a complete successful read. `status` uses that cache and freshly hashes mapped local files. Use these variants when needed:

```sh
pnpm design:status --refresh   # fetch Figma first
pnpm design:status --all       # show every node and mapping detail
pnpm --silent design:status --json
```

Read the dashboard in this order:

| Section                 | Meaning                                                           |
| ----------------------- | ----------------------------------------------------------------- |
| Implementation coverage | How many active designs have explicit code mappings               |
| Figma readiness         | Ready for dev, Completed, unmarked, and unknown counts from Figma |
| Revision health         | Drift relative to explicitly accepted baselines                   |
| Needs attention         | Prioritized nodes with exact IDs and reasons                      |

Status values mean:

| Status                                 | Action                                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------------ |
| `NOT_IMPLEMENTED` + `MAPPING_MISSING`  | Find or implement the UI, then register its files                                    |
| `NOT_IMPLEMENTED` + `BASELINE_MISSING` | Code is mapped; verify it before accepting the first baseline                        |
| `IMPLEMENTED`                          | Current cached design and code match the accepted baseline                           |
| `DESIGN_CHANGED`                       | Review the Figma changes and update code if needed                                   |
| `CODE_CHANGED`                         | Explain and verify the code change before accepting a new baseline                   |
| `NEEDS_REVIEW`                         | Resolve missing data, simultaneous changes, invalid files, or unsupported structures |
| `IGNORED`                              | Intentionally excluded from implementation tracking                                  |

`IMPLEMENTED` means baseline agreement. It is not proof of visual equivalence.

## 5. Map a design to code

Register every implementation file that materially represents the design. Paths are repository-relative.

```sh
pnpm design:register \
  --node '123:456' \
  --route '/example/[id]' \
  --files 'src/app/example/[id]/page.tsx,src/components/example-view.tsx'
```

Registration is idempotent for an identical mapping and does not establish a baseline. Use `--replace` only when intentionally changing an existing mapping; replacement invalidates its old baseline.

After implementing and testing the UI, review it and accept one node explicitly:

```sh
pnpm design:diff --node '123:456'
pnpm design:sync --node '123:456'
pnpm design:status
```

For a new mapping, `diff` reports that no baseline exists. That is expected; inspect the live design and application instead. `sync` records the currently observed design and mapped code as the accepted baseline. There is no bulk sync.

## Use an agent

Install the optional project instruction for your agent once:

```sh
pnpm design:init --agent codex
# or: claude / cursor
```

Then ask the agent to run:

```sh
pnpm --silent design:agent-plan --json
```

The result contains a `copyablePrompt`, candidate identities, and two independent approval gates:

1. `approval.question` must be answered before launching a mapping agent that consumes model tokens.
2. `figmaCompletionApproval.question` must be answered after implementation and verification, before an authenticated Figma tool marks the listed nodes Completed.

Approval to start an agent does not authorize a Figma write or baseline acceptance. The CLI never writes to Figma. See [Agent integration](./agents.md) for the complete protocol.

## Project files and Git

| Location                     | Commit? | Purpose                                                |
| ---------------------------- | ------- | ------------------------------------------------------ |
| `.design-sync/config.json`   | Yes     | Figma source, discovery roots, and CI policy           |
| `.design-sync/manifest.json` | Yes     | Node-to-code mappings and accepted baseline references |
| `.design-sync/snapshots/`    | Yes     | Compact accepted normalized design snapshots           |
| `.design-sync/cache/`        | No      | Replaceable observations from scans                    |
| `tools/design-sync/.env`     | No      | Local Figma credential                                 |
| `tools/design-sync/`         | Yes     | Registry-owned CLI source                              |
| `docs/design-sync/`          | Yes     | Registry-owned documentation                           |

Snapshots can contain design text and properties. Keep the repository access level appropriate for that content.

## Common problems

- `MISSING_TOKEN`: add `FIGMA_ACCESS_TOKEN` to an exported environment or one of the supported `.env` files. Check that an empty exported variable is not overriding the file.
- `FIGMA_FILE_INACCESSIBLE`: confirm `--file` contains only the file key, the token can open that file, and the token has `file_content:read`.
- `TRACKING_ROOT_MISSING`: convert URL `node-id=123-456` to `123:456` and confirm the node belongs to the configured file.
- `SCAN_REQUIRED`: run `pnpm design:scan`; tracking changes invalidate the old cache.
- Status says mapped code is `NOT_IMPLEMENTED`: inspect the reason. `BASELINE_MISSING` means the mapping exists but has not been accepted.
- Package-manager banners break JSON parsing: use `pnpm --silent design:status --json` or invoke `pnpm exec tsx tools/design-sync/cli.ts status --json` directly.

See [Figma provider](./figma.md) for authentication and API failures, and [Commands](./commands.md) for the complete interface.

## Upgrade

1. Commit project state and local toolkit customizations.
2. Inspect `npx shadcn@latest add https://registry.manosnits.com/r/design-sync.json --dry-run` and `--diff`.
3. Apply the reviewed update. Use `--overwrite` only when ready to replace registry-owned files.
4. Run `pnpm design:migrate`; add `--apply` only after reviewing the preview.
5. Run `pnpm design:scan` and inspect status.

Registry updates replace toolkit source and documentation. They preserve `.design-sync/` state and local credentials.
