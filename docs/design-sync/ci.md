---
title: CI and verification
description: Enforce design synchronization policy in continuous integration.
---

# CI and verification

Install devDependencies: the distributed CLI uses tsx, Zod, and Commander as development tools. Run from repository root or pass --root.

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 22
- uses: pnpm/action-setup@v4
  with:
    version: 10.32.1
- run: pnpm install --frozen-lockfile
- run: pnpm --silent design:check --json
  env:
    FIGMA_ACCESS_TOKEN: ${{ secrets.FIGMA_ACCESS_TOKEN }}
```

Check always fetches fresh designs. Exit 0 means the configured policy is satisfied, 1 means a policy violation, and 2 means configuration/infrastructure/tool failure. Authentication or network failures never become green cached checks.

Default policy fails on NEEDS_REVIEW only. To require synchronized designs and implementation coverage:

```json
{
  "ci": {
    "failOn": [
      "DESIGN_CHANGED",
      "CODE_CHANGED",
      "NOT_IMPLEMENTED",
      "MAPPED_AWAITING_BASELINE",
      "NEEDS_REVIEW"
    ]
  }
}
```

Policy enums are runtime-validated. Treat exit 2 as a failed CI job even if design drift is temporarily allowed. Figma rate limits can constrain fresh checks; configure workflow frequency accordingly and inspect Retry-After diagnostics.

## Toolkit validation

`pnpm verify` runs typecheck, lint, tests, registry generation/build, and validation against shadcn's schemas. `pnpm test:install` exercises actual HTTP registry installation into clean consumers and checks state preservation on upgrade. CI runs these on Linux, macOS, and Windows; the local verification record distinguishes executed checks from configured future CI runs.

For real-Figma acceptance run `pnpm test:live` with FIGMA_ACCESS_TOKEN, DESIGN_SYNC_TEST_FILE, and DESIGN_SYNC_TEST_NODE. A missing credential/file intentionally fails rather than claiming a skipped test passed.

## V2 priorities

1. Real rendered comparison through the optional visual adapter, with viewport, route/story fixtures, fonts, masks, and tolerances specified.
2. Multi-file sources and explicit state migrations.
3. Validated MCP transport with unattended authentication and complete snapshot semantics.
4. External library and variable-mode coverage; measured incremental caching for large files.
5. Optional GitHub integration and separately installable core/provider/agent registry items.
