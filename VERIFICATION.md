# Verification record

Implementation date: 2026-09-24. Local host: macOS, Node 26.9.0, pnpm 10.32.1. Registry CLI: shadcn 4.21.0.

## Executed locally

- TypeScript strict typecheck and ESLint.
- 76 automated unit/integration/CLI tests covering normalization, hashes, semantic diffs, Figma Dev Mode status tracking, status classification, schema validation, synthetic migration preview/backups, Windows path-alias handling, path safety, state locking, corrupt snapshots, provider errors/batching/retries, JSON output, approval-gated agent handoffs, and lifecycle behavior.
- Registry generation, build, and validation against the installed shadcn schemas: 36 bundled files.
- Actual HTTP registry installations into three disposable consumer fixtures: plain TypeScript (CommonJS parent package), existing shadcn (ESM), and a pnpm monorepo.
- Installed CLI initialization, scan, approval-gated agent planning without agent launch, registration without baseline, explicit sync, status, diff, JSON parsing, policy exit 1, infrastructure exit 2, and rejection of bulk sync.
- Reinstallation with overwrite: every project state byte preserved, including manifest, snapshots, configuration and cache. Existing styles, components configuration, environment examples, package scripts, and custom package fields preserved.
- Nested monorepo invocation resolves repository state and shared implementation files.
- Dotenv lookup regression tests cover exported-value precedence, root and toolkit files, missing/unreadable files, and isolation from application variables. Actual installation tests now supply credentials through dotenv. Registry source enumeration excludes local .env files.
- Formatting check for maintained files. Registry JSON and generated JSON Schemas are excluded from formatting because the generator owns them.

## Not executed / not delivered

- Real-Figma acceptance of the full disposable-baseline workflow remains pending. Run `pnpm test:live` with FIGMA_ACCESS_TOKEN, DESIGN_SYNC_TEST_FILE, and DESIGN_SYNC_TEST_NODE. Real read-only scans in a private consumer project succeeded after the dotenv fix. No consumer identifiers, Figma data, or synchronization baseline are included here.
- Linux/Windows execution: CI matrix is configured but has not run from this local repository. Windows symlink escape testing is skipped because it requires additional OS privileges; path normalization is covered on all platforms.
- Production deployment is configured for Vercel at `registry.manosnits.com`, but the Vercel project and DNS still need to be connected before the public URL can be accepted as live.
- Visual equivalence: extension interface only. V1 tracks explicitly accepted revisions, not rendered similarity.

The installation tests use a controlled Figma response transport to exercise the real installed CLI. They do not substitute for live API acceptance. Migration tests use a synthetic future step to exercise backup/preservation; V1 has no invented legacy production migration.
