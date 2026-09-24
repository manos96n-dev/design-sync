# Figma provider

Create a personal access token with `file_content:read` and access to the design file. Supply it via `FIGMA_ACCESS_TOKEN` in the process environment. Do not put it in config, command-line arguments, snapshots, Git, or chat. The CLI neither creates credentials nor automatically reads dotenv files.

Copy fileKey from the Figma URL and canonical node IDs from links. V1 reads one file or branch key per repository. Nodes are identified by fileKey/nodeId, never their names. Renames preserve mappings; moving a tracked root on its canvas does not change its revision. Moving descendants relative to each other does.

## Why REST for tracking

The normal CLI and CI need documented node data, batched reads, geometry, and repeatable file-version selection without relying on an interactive agent session. The REST adapter requests `/v1/files/:key/nodes?ids=...&geometry=paths`. It reuses root descendants, requests at most 50 IDs per batch, limits encoded IDs to 6000 URL characters, and permits at most two concurrent follow-up requests. Follow-ups are pinned to the first observed version. Multiple requests without version data fail closed.

MCP is not inherently agent-only. An MCP transport could implement the provider interface later after validating complete data extraction and unattended authentication. In V1 agents should use Figma MCP for design context, screenshots, variables, and Code Connect while the CLI owns revisions and accepted baselines.

HTTP requests time out after 30 seconds and have at most three attempts. Network/server failures retry with bounded backoff. Short Retry-After delays are honored; delays above ten seconds produce an actionable rate-limit error. Actual limits depend on the Figma plan/seat. Cached status is useful when live reads are limited. A failed live check never falls back to cached success.

## Troubleshooting

- MISSING_TOKEN: export the token in the process environment.
- FIGMA_ACCESS_DENIED: check expiry, scope, and file permissions.
- FIGMA_FILE_INACCESSIBLE: verify file key and access; this does not prove deletion.
- DESIGN_MISSING: a requested node is null within an accessible file; verify identity or restore it. Existing mappings remain NEEDS_REVIEW.
- TRACKING_ROOT_MISSING: update configuration or restore the root before scanning.
- FIGMA_RATE_LIMIT: honor the reported retry time; use cached status for inspection.
- INVALID_PROVIDER_DATA / INCONSISTENT_OBSERVATION: no new cache is saved. Retry or narrow roots; report incompatible API data.
- UNSUPPORTED_DESIGN: inspect normalization issues before accepting a baseline.

## Limits and sources

Scopes, snapshots, and diffs reflect the node properties covered by normalization, not every Figma feature. No external-library traversal, screenshot comparison, font rendering, or variable-mode simulation is implemented. Cached status cannot detect changes made after its observation time. Large subtrees still have download and memory costs even with request batching.

Official references: [REST endpoints](https://developers.figma.com/docs/rest-api/file-endpoints/), [node properties](https://developers.figma.com/docs/rest-api/file-node-types/), [authentication](https://developers.figma.com/docs/rest-api/authentication/), [rate limits](https://developers.figma.com/docs/rest-api/rate-limits/), [MCP tools](https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/).
