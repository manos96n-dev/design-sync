import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { z } from "zod";
import {
  configSchema,
  manifestSchema,
  snapshotSchema,
  reportEnvelopeSchema,
  errorEnvelopeSchema,
  successEnvelopeSchema,
} from "../registry/design-sync/core/schemas.js";
async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) =>
        entry.isDirectory()
          ? walk(`${directory}/${entry.name}`)
          : Promise.resolve([`${directory}/${entry.name}`]),
      ),
    )
  )
    .flat()
    .sort();
}
await mkdir("registry/design-sync/schemas", { recursive: true });
for (const [name, schema] of Object.entries({
  config: configSchema,
  manifest: manifestSchema,
  snapshot: snapshotSchema,
  report: reportEnvelopeSchema,
  error: errorEnvelopeSchema,
  success: successEnvelopeSchema,
}))
  await writeFile(
    `registry/design-sync/schemas/${name}.json`,
    JSON.stringify(z.toJSONSchema(schema), null, 2) + "\n",
  );
const pkg = JSON.parse(await readFile("package.json", "utf8")) as {
  devDependencies: Record<string, string>;
  version: string;
};
const files = [
  ...(await walk("registry/design-sync")).map((file) => ({
    path: file,
    type: "registry:file",
    target: `~/tools/design-sync/${file.slice("registry/design-sync/".length)}`,
  })),
  ...(await walk("docs/design-sync")).map((file) => ({
    path: file,
    type: "registry:file",
    target: `~/${file}`,
  })),
];
const registry = {
  $schema: "https://ui.shadcn.com/schema/registry.json",
  name: "design-sync",
  homepage:
    process.env.REGISTRY_HOMEPAGE ?? "https://example.invalid/design-sync",
  items: [
    {
      name: "design-sync",
      type: "registry:item",
      title: "Design Sync",
      description: "Framework-independent Figma/code synchronization tracking.",
      devDependencies: ["tsx", "zod", "commander"].map(
        (name) => `${name}@${pkg.devDependencies[name]}`,
      ),
      files,
      docs: "Run pnpm exec tsx tools/design-sync/cli.ts init. Configure FIGMA_ACCESS_TOKEN in your environment. Read docs/design-sync/README.md.",
      meta: { toolVersion: pkg.version },
    },
  ],
};
await writeFile("registry.json", JSON.stringify(registry, null, 2) + "\n");
