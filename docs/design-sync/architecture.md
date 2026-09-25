---
title: Architecture
description: Understand Design Sync state, revisions, normalization, and classification.
---

# Architecture and schemas

```text
shadcn registry → tools/design-sync/cli.ts → command workflows
                                          ├─ pure core
                                          ├─ storage → .design-sync/
                                          └─ DesignProvider → Figma REST
Developers / agents / CI ← versioned JSON or human output
```

Core code depends on Node and validated domain data, never React, Tailwind, Next.js, shadcn, or Figma REST types. `DesignProvider` exposes getNode/getNodes and an optional reference-image method. `VisualVerifier` reserves an optional screenshot-comparison boundary; V1 does not implement that verification.

## Configuration

```json
{
  "version": 1,
  "provider": "figma",
  "figma": { "fileKey": "YOUR_FILE_KEY" },
  "tracking": {
    "roots": ["0:1"],
    "include": [],
    "exclude": [],
    "nodeTypes": ["FRAME", "COMPONENT", "COMPONENT_SET"]
  },
  "ci": { "failOn": ["NEEDS_REVIEW"] }
}
```

One file per repository in V1. Roots are discovery containers; explicit includes can track a root or a nested node itself. Empty roots use explicitly included/registered nodes, never the entire file. Exclusions win over explicit includes and registrations. Changing tracking configuration invalidates cached observations. Replacing fileKey with existing mappings is rejected; use separate state until an explicit cross-file migration exists.

Paths resolve from explicit --root, an existing ancestor state directory, Git root, then the nearest package directory. File mappings are sorted, deduplicated, repository-relative POSIX paths. Windows separators are accepted. Absolute paths, parent traversal, and symlinks escaping the root are rejected. Shared files may belong to multiple mappings.

## Manifest

```json
{
  "version": 1,
  "nodes": {
    "<base64url-canonical-reference>": {
      "reference": {
        "provider": "figma",
        "fileKey": "FIGMA_FILE_KEY",
        "nodeId": "123:456"
      },
      "name": "Example screen",
      "type": "FRAME",
      "implementation": {
        "files": ["src/components/example-view.tsx"],
        "route": "/example/[id]"
      },
      "baseline": {
        "designRevision": "sha256:<64 lowercase hex characters>",
        "codeRevision": "sha256:<64 lowercase hex characters>",
        "snapshot": "snapshots/<identity>/<design-digest>.json",
        "lastSyncedAt": "2025-01-01T00:00:00.000Z"
      }
    }
  }
}
```

The identity key encodes the entire canonical provider/file/node reference. Names are display metadata. `route`, `story`, and `test` are optional. `baseline` is absent until explicit synchronization. Replacing a mapping invalidates its baseline; repeating the same mapping preserves it.

## Snapshots and revisions

A snapshot contains `version`, `normalizationVersion`, `reference`, `designRevision`, and `node`. A normalized node contains `id`, `name`, `type`, optional `devStatus`, `properties`, `children`, and `issues`. Published JSON Schemas live in `tools/design-sync/schemas/`.

Design hashing excludes display names, Figma Dev Mode status, and canvas translation of the tracked root. Child identity/order and relative layout remain meaningful. The provider allowlist covers dimensions, constraints, auto-layout, sizing, grid layout, fills/strokes, radii, effects, opacity, text/runs/styles, component references/properties, variable bindings, visibility, and vector geometry. Object keys are canonical; arrays retain order. Volatile API/editor data is excluded. Unknown node types and missing vector geometry require review.

Figma property additions are not automatically included: extend the tested normalization allowlist and increment normalization version when semantics change. The REST response supplies resolved appearance plus references; V1 does not recursively retrieve external library definitions or implement variable-mode simulation. This is design-state tracking, not a complete rendering engine.

Code hashing combines sorted normalized paths with CRLF-normalized file bytes. Other whitespace and binary bytes are preserved. No Git commit SHA is used. Only explicitly mapped files are hashed; shared dependencies must be mapped explicitly if their changes should count.

Semantic diffs match stable IDs and report readable labels plus ID paths. Child order and parent changes are explicit properties. A pure display rename neither changes the design revision nor appears as an implementation change.

Snapshots are written before their manifest references. Interrupted writes can leave an unreferenced snapshot but cannot create a manifest referring to a partially written snapshot. A process lock serializes state mutations. A leftover write.lock requires verifying the recorded process is stopped before manual removal.

## Classification

Ignored takes precedence. Missing designs, invalid mappings/files, corrupt snapshots, and unsupported structures require review. A design without a code mapping is NOT_IMPLEMENTED. A mapped design without an accepted baseline is MAPPED_AWAITING_BASELINE. Otherwise equal revisions mean IMPLEMENTED; design-only/code-only changes yield DESIGN_CHANGED/CODE_CHANGED; both changes yield NEEDS_REVIEW.

`NOT_IMPLEMENTED` means no implementation mapping is registered; it does not prove that no code exists elsewhere in the repository. `MAPPED_AWAITING_BASELINE` means a mapping exists but has not yet been accepted. Reports also include a coverage breakdown: active designs, mappings to code, mapped nodes awaiting baseline acceptance, accepted baselines, and unmapped nodes.

`IMPLEMENTED` means agreement with an explicitly accepted baseline and the reported design observation. It never asserts visual equivalence or that cached designs are currently live.

State schemas preserve extension fields. Tool, configuration, manifest, snapshot, normalization, and output versions are independently identified. Unknown schema versions fail closed; explicit migration steps preserve extensions and create backups before applying changes.
