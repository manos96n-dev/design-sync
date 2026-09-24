# Design Sync

A framework-independent Node.js/TypeScript toolkit that tracks explicit synchronization between Figma nodes and implementation files. Distributed as source through a universal shadcn registry item.

**V1 provides change tracking, not automatic UI generation or visual equivalence certification.**

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm test:install
```

Build output: `public/r/design-sync.json`. Serve `public/` on a static host when ready. No public deployment is configured yet.

See [installation and quick start](docs/design-sync/README.md), [architecture and schemas](docs/design-sync/architecture.md), [commands](docs/design-sync/commands.md), [Figma access](docs/design-sync/figma.md), [agent workflow](docs/design-sync/agents.md), and [CI](docs/design-sync/ci.md).

## Development

Node >=22.12, pnpm 10.32.1. `pnpm design --help` runs the source CLI. Tool version is independent from state/output/normalization schema versions. `pnpm registry:build` enumerates distribution files, generates JSON schemas, builds with pinned shadcn 4.21.0, then validates its output. Set `REGISTRY_HOMEPAGE` to your public registry homepage for release builds.

`pnpm test:install` serves the real payload over localhost and invokes the shadcn CLI against disposable plain TypeScript, existing-shadcn, and monorepo consumers. It also reinstalls the tool over existing state. Network access to the package registry is required. Tests delete only their own temporary directories.

`pnpm test:live` requires `FIGMA_ACCESS_TOKEN`, `DESIGN_SYNC_TEST_FILE`, and `DESIGN_SYNC_TEST_NODE` in your environment. It checks real reads and baseline establishment in a disposable project without changing the Figma file. Fixture tests do not replace this acceptance test.

See [verification record](VERIFICATION.md) for what has actually run.
