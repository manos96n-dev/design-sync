---
title: Commands
description: Reference every CLI command, option, exit code, and JSON response.
---

# Commands and machine interface

Every command supports `--root <repository>` and `--json`. Run commands from the repository root unless `--root` points elsewhere. Package scripts are installed only when missing. If a script conflicts, use `pnpm exec tsx tools/design-sync/cli.ts <command>` directly. Agents should add `--silent` to package-script calls so stdout remains one parseable JSON document.

## Choose the command

| I want to…                                               | Command             |
| -------------------------------------------------------- | ------------------- |
| Set up a repository or install agent instructions        | `design:init`       |
| Fetch the current Figma state                            | `design:scan`       |
| Inspect cached design state against current local files  | `design:status`     |
| Connect one design to its implementation files           | `design:register`   |
| Prepare a safe agent handoff                             | `design:agent-plan` |
| See semantic changes from an accepted design baseline    | `design:diff`       |
| Accept one verified design/code pair as the new baseline | `design:sync`       |
| Enforce policy in CI using a fresh Figma read            | `design:check`      |
| Preview or apply state-schema upgrades                   | `design:migrate`    |

| Script            | Arguments                                                                                  | Behavior                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| design:init       | --file KEY --tracking-roots IDS --agent codex\|claude\|cursor                              | Create only missing state, scripts and optional instructions; warn about setup  |
| design:register   | --node ID --files PATHS [--route URL] [--story ID] [--test PATH] [--name NAME] [--replace] | Register mapping; never accept a baseline                                       |
| design:scan       | [--all]                                                                                    | Fetch design state, discover units, calculate status, replace observation cache |
| design:status     | [--refresh] [--all]                                                                        | Cached design plus freshly hashed code; refresh explicitly contacts Figma       |
| design:agent-plan | [--refresh]                                                                                | Prepare a read-only, approval-gated agent mapping handoff; starts no agent      |
| design:diff       | ID or --node ID [--refresh]                                                                | Semantic diff against accepted snapshot; missing baseline is an error           |
| design:sync       | --node ID                                                                                  | Explicit acceptance of fresh design and current mapped code                     |
| design:check      | [--all]                                                                                    | Fresh scan; configured policy controls exit status                              |
| design:migrate    | [--apply]                                                                                  | Preview or apply supported schema migrations                                    |
| design:version    |                                                                                            | Tool and schema versions                                                        |

File lists are comma-separated; filenames containing commas are not supported by this CLI form. Node IDs use Figma's canonical colon form, e.g. `123:456`. Convert URL `node-id=123-456` to `123:456`. --root is the repository directory; --tracking-roots contains design node IDs.

## Common recipes

```sh
# Daily local inspection: cached design, current code
pnpm design:status

# Refresh from Figma before inspection
pnpm design:status --refresh

# Show every tracked node and mapping detail
pnpm design:status --all

# Parse complete results from an agent or script
pnpm --silent design:status --json

# Register one mapping; this does not accept a baseline
pnpm design:register --node '123:456' --files 'src/example-view.tsx' --route '/example/[id]'

# Inspect and then explicitly accept one verified node
pnpm design:diff --node '123:456'
pnpm design:sync --node '123:456'

# CI always performs a live Figma refresh
pnpm --silent design:check --json
```

`status` never contacts Figma unless `--refresh` is present. `scan`, `check`, refreshed status/diff/agent-plan, and `sync` require credentials and network access. Failed live reads do not replace the last complete cache.

Exit codes: 0 completed successfully; 1 CI policy violated; 2 configuration, argument, network, or tool failure. Status and scan return 0 when observation succeeds even if individual nodes need review. Only check applies policy. Sync has no --all option and refuses ignored nodes or unsupported normalized structures.

Human report commands default to a concise dashboard: implementation coverage, Figma readiness, revision health, and prioritized action groups. Long groups show a representative subset and their hidden count. Pass `--all` to expand every tracked node with route, mapped files, reasons, and change counts. JSON output always contains every node, regardless of `--all`.

`agent-plan` is safe to run before approval because it only reads status (or refreshes when explicitly requested). Its JSON result always reports `agentStarted: false`, including after an external host has launched an agent. When mappings are missing, it includes candidate identities, a `copyablePrompt`, a token-use notice, the exact launch question, and `promptAfterApproval`. It also returns `figmaCompletionApproval`, a second contract used only after implementation and verification. Human output delimits copyable text so it can be pasted without editing.

## JSON contract

stdout is exactly one JSON document. The CLI never mixes banners or progress output with JSON. Errors use `{schemaVersion,toolVersion,command,ok:false,error:{code,message,details}}`. Successful commands use `{schemaVersion,toolVersion,command,ok:true,result}`. Stable reason/error codes accompany human-readable explanations. Schemas are distributed under `tools/design-sync/schemas/`.

Scripts should check the process exit code and the envelope's `ok` field. Exit `0` means command success, exit `1` is reserved for a `check` policy violation, and exit `2` means an argument, configuration, authentication, network, or tool failure.

Illustrative abbreviated status response (digest placeholders stand for 64 hex characters):

```json
{
  "schemaVersion": 1,
  "toolVersion": "0.1.0",
  "command": "status",
  "ok": true,
  "result": {
    "observedAt": "2025-01-01T00:00:00.000Z",
    "freshness": { "source": "cache", "ageSeconds": 30 },
    "summary": {
      "implemented": 0,
      "designChanged": 1,
      "notImplemented": 0,
      "codeChanged": 0,
      "needsReview": 0,
      "ignored": 0,
      "devStatus": {
        "readyForDev": 1,
        "completed": 0,
        "none": 0,
        "unknown": 0
      },
      "coverage": {
        "active": 1,
        "mappedToCode": 1,
        "mappedAwaitingBaseline": 0,
        "acceptedBaselines": 1,
        "unmapped": 0
      }
    },
    "nodes": [
      {
        "reference": {
          "provider": "figma",
          "fileKey": "FIGMA_FILE_KEY",
          "nodeId": "123:456"
        },
        "nodeId": "123:456",
        "name": "Example screen",
        "status": "DESIGN_CHANGED",
        "devStatus": {
          "type": "READY_FOR_DEV",
          "description": "Updated header is ready"
        },
        "route": "/example/[id]",
        "implementationFiles": ["src/components/example-view.tsx"],
        "baselineDesignRevision": "sha256:<previous-design-digest>",
        "currentDesignRevision": "sha256:<current-design-digest>",
        "baselineCodeRevision": "sha256:<code-digest>",
        "currentCodeRevision": "sha256:<code-digest>",
        "reasons": [],
        "changes": [
          {
            "type": "MODIFIED",
            "path": "123:456/123:457",
            "label": "Example screen/Header",
            "property": "height",
            "before": 64,
            "after": 72
          }
        ]
      }
    ]
  }
}
```

```text
Example screen

1 changes

~ Example screen/Header.height [123:456/123:457]
  64 → 72
```

After sync, an existing compatible observation cache is updated for that node. Other observations retain their original age; no complete scan is fabricated. If no cache exists, run scan before status.
