# Design Sync

Design Sync is a framework-independent TypeScript CLI for tracking the relationship between Figma designs and implementation files. It answers four practical questions:

- Which designs have no code mapping?
- Which mapped designs have changed in Figma or code since an accepted baseline?
- Which designs need human review?
- Which Figma frames are marked Ready for dev or Completed?

Design Sync records explicit baselines. It does not generate UI or claim visual equivalence.

## Use it in a project

Install the registry item from your hosted registry, then initialize it at the repository root:

```sh
npx shadcn@latest add https://registry.manosnits.com/r/design-sync.json
pnpm exec tsx tools/design-sync/cli.ts init \
  --file 'YOUR_FIGMA_FILE_KEY' \
  --tracking-roots '12:345'
```

Set `FIGMA_ACCESS_TOKEN` in your shell, repository `.env`, or `tools/design-sync/.env`, then run:

```sh
pnpm design:scan
pnpm design:status
```

The [consumer quick start](docs/design-sync/README.md) explains how to read a Figma URL, configure credentials, map code, accept a baseline, use agents safely, and troubleshoot setup. The other references cover [commands](docs/design-sync/commands.md), [Figma access](docs/design-sync/figma.md), [agents](docs/design-sync/agents.md), [CI](docs/design-sync/ci.md), and [architecture](docs/design-sync/architecture.md).

## Human and agent workflows

Humans normally use the formatted dashboard:

```sh
pnpm design:status
pnpm design:status --all
```

Agents should consume the versioned JSON contract:

```sh
pnpm --silent design:status --json
pnpm --silent design:agent-plan --json
```

`agent-plan` never launches an agent. It returns the exact approval question that must be shown before spending model tokens. Marking verified nodes Completed in Figma requires a second, separate approval. The CLI itself only reads Figma.

## Develop this toolkit

Requirements: Node >=22.12 and pnpm 10.32.1.

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm test:install
```

`pnpm registry:build` generates `public/r/design-sync.json` and validates it against the pinned shadcn CLI. The default homepage is `https://registry.manosnits.com`; `REGISTRY_HOMEPAGE` can override it for another deployment.

`pnpm test:install` serves the actual payload locally and installs it into disposable plain TypeScript, existing-shadcn, and monorepo projects. `pnpm test:live` performs a read-only real-Figma acceptance test and requires `FIGMA_ACCESS_TOKEN`, `DESIGN_SYNC_TEST_FILE`, and `DESIGN_SYNC_TEST_NODE`.

See the [verification record](VERIFICATION.md) for checks that have actually run and remaining limitations.

## Deploy the registry on Vercel

This repository includes `vercel.json` and serves the generated `public/` directory. Import the GitHub repository as a Vercel project and keep the repository root as the project root. Vercel will install with pnpm, build the registry, and publish:

- `https://registry.manosnits.com/r/design-sync.json` — installable registry item
- `https://registry.manosnits.com/r/registry.json` — registry index
- `https://registry.manosnits.com/` — small installation page

Add `registry.manosnits.com` under the Vercel project's **Settings → Domains**, then create the CNAME record Vercel shows through the DNS provider for `manosnits.com`. Use the value reported for the project rather than copying a generic CNAME value. Every push to `main` will deploy after the Git-integrated build succeeds.

Verify production before sharing it:

```sh
curl -fsS https://registry.manosnits.com/r/design-sync.json \
  | jq -e '.name == "design-sync" and .type == "registry:item"'
npx shadcn@latest add https://registry.manosnits.com/r/design-sync.json
```

The existing apex portfolio can stay on its current Vercel project. A separate registry subdomain avoids moving `manosnits.com` between projects. See Vercel's [custom-domain setup](https://vercel.com/docs/domains/set-up-custom-domain) and [project configuration](https://vercel.com/docs/project-configuration/vercel-json) references.
