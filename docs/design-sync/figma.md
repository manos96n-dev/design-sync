---
title: Figma provider
description: Configure Figma access and understand Design Sync's REST tracking model.
---

# Figma provider

Create a personal access token with `file_content:read` and access to the design file. For local use, copy `tools/design-sync/.env.example` to `tools/design-sync/.env` and set `FIGMA_ACCESS_TOKEN`. You may instead use the repository-root `.env` or export the variable in your shell.

Lookup order is exported environment, repository-root `.env`, then `tools/design-sync/.env`. Existing environment values win, including an explicitly empty value. The CLI imports no other application variables. Do not put the token in Design Sync configuration, command arguments, snapshots, Git, or chat.

From `https://www.figma.com/design/FILE_KEY/Name?node-id=12-458`, use `FILE_KEY` for `--file` and convert the node query value to `123:456`. Pass raw values, not the complete URL or a Markdown link. V1 reads one file or branch key per repository. Nodes are identified by fileKey/nodeId, never their names. Renames preserve mappings; moving a tracked root on its canvas does not change its revision. Moving descendants relative to each other does.

Verify setup with a live scan:

```sh
pnpm design:scan
```

Once a scan succeeds, normal `design:status` reads the cache and does not need the token until the next refresh.

## Why REST for tracking

The normal CLI and CI need documented node data, batched reads, geometry, and repeatable file-version selection without relying on an interactive agent session. The REST adapter requests `/v1/files/:key/nodes?ids=...&geometry=paths`. It reuses root descendants, requests at most 50 IDs per batch, limits encoded IDs to 6000 URL characters, and permits at most two concurrent follow-up requests. Follow-ups are pinned to the first observed version. Multiple requests without version data fail closed.

The same node response includes Figma Dev Mode `devStatus` metadata for supported frames, components, instances, and sections. The toolkit records `READY_FOR_DEV`, `COMPLETED`, or `null`, plus the optional designer description. This uses the existing `file_content:read` scope. Live scan/check/refresh commands update it; cached status reports the last observation. Dev status is workflow metadata and is excluded from visual revision hashes and semantic diffs.

The Design Sync CLI is read-only with respect to Figma and cannot mark a node `COMPLETED`. An agent may propose that change only after it implements and verifies the corresponding code. It must list each exact `fileKey`, `nodeId`, and name, ask the separate `figmaCompletionApproval.question`, and wait for explicit approval. If approved, the agent uses an available authenticated Figma write integration, updates only the approved nodes, reads them back, and runs a fresh Design Sync scan. Without approval or a suitable write tool, Figma remains unchanged.

## REST and MCP have different jobs

The CLI uses REST for repeatable, unattended tracking in local shells and CI. Agents may also use Figma MCP for richer design context, screenshots, variables, and Code Connect. MCP context helps an agent understand and implement a design; CLI revisions and explicit baselines remain the tracking record. A future provider may add MCP as a transport after its extraction and unattended-authentication behavior is validated.

HTTP requests time out after 30 seconds and have at most three attempts. Network/server failures retry with bounded backoff. Short Retry-After delays are honored; delays above ten seconds produce an actionable rate-limit error. Actual limits depend on the Figma plan/seat. Cached status is useful when live reads are limited. A failed live check never falls back to cached success.

## Troubleshooting

- MISSING_TOKEN: set the token in the process environment, root `.env`, or `tools/design-sync/.env`.
- FIGMA_ACCESS_DENIED: check expiry, scope, and file permissions.
- FIGMA_FILE_INACCESSIBLE: verify file key and access; this does not prove deletion.
- DESIGN_MISSING: a requested node is null within an accessible file; verify identity or restore it. Existing mappings remain NEEDS_REVIEW.
- TRACKING_ROOT_MISSING: update configuration or restore the root before scanning.
- FIGMA_RATE_LIMIT: honor the reported retry time; use cached status for inspection.
- INVALID_PROVIDER_DATA / INCONSISTENT_OBSERVATION: no new cache is saved. Retry or narrow roots; report incompatible API data.
- UNSUPPORTED_DESIGN: inspect normalization issues before accepting a baseline.

## Limits and sources

Scopes, snapshots, and diffs reflect the node properties covered by normalization, not every Figma feature. No external-library traversal, screenshot comparison, font rendering, or variable-mode simulation is implemented. Cached status cannot detect changes made after its observation time. Large subtrees still have download and memory costs even with request batching.

Official references: [REST endpoints](https://developers.figma.com/docs/rest-api/file-endpoints/), [node properties](https://developers.figma.com/docs/rest-api/file-node-types/), [DevStatus property](https://developers.figma.com/docs/rest-api/file-property-types/), [authentication](https://developers.figma.com/docs/rest-api/authentication/), [rate limits](https://developers.figma.com/docs/rest-api/rate-limits/), [MCP tools](https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/).
