# Commands and machine interface

Every command supports `--root <repository>` and `--json`. Package scripts are installed only when missing. Direct fallback: `pnpm exec tsx tools/design-sync/cli.ts <command>`. For agents use `pnpm --silent design:status --json` or direct Node/tsx invocation to avoid package-manager banners.

| Script          | Arguments                                                                                  | Behavior                                                                        |
| --------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| design:init     | --file KEY --tracking-roots IDS --agent codex\|claude\|cursor                              | Create only missing state, scripts and optional instructions; warn about setup  |
| design:register | --node ID --files PATHS [--route URL] [--story ID] [--test PATH] [--name NAME] [--replace] | Register mapping; never accept a baseline                                       |
| design:scan     |                                                                                            | Fetch design state, discover units, calculate status, replace observation cache |
| design:status   | [--refresh]                                                                                | Cached design plus freshly hashed code; refresh explicitly contacts Figma       |
| design:diff     | ID or --node ID [--refresh]                                                                | Semantic diff against accepted snapshot; missing baseline is an error           |
| design:sync     | --node ID                                                                                  | Explicit acceptance of fresh design and current mapped code                     |
| design:check    |                                                                                            | Fresh scan; configured policy controls exit status                              |
| design:migrate  | [--apply]                                                                                  | Preview or apply supported schema migrations                                    |
| design:version  |                                                                                            | Tool and schema versions                                                        |

File lists are comma-separated; filenames containing commas are not supported by this CLI form. Node IDs use Figma's canonical colon form, e.g. `123:456`. Convert URL `node-id=12-458` to `123:456`. --root is the repository directory; --tracking-roots contains design node IDs.

Exit codes: 0 completed successfully; 1 CI policy violated; 2 configuration, argument, network, or tool failure. Status and scan return 0 when observation succeeds even if individual nodes need review. Only check applies policy. Sync has no --all option and refuses ignored nodes or unsupported normalized structures.

## JSON contract

stdout is exactly one JSON document. The CLI never mixes banners or progress output with JSON. Errors use `{schemaVersion,toolVersion,command,ok:false,error:{code,message,details}}`. Successful commands use `{schemaVersion,toolVersion,command,ok:true,result}`. Stable reason/error codes accompany human-readable explanations. Schemas are distributed under `tools/design-sync/schemas/`.

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
      "ignored": 0
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
