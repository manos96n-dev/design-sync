import { readFile } from "node:fs/promises";
import { registrySchema, registryItemSchema } from "shadcn/schema";
const registry = registrySchema.parse(
  JSON.parse(await readFile("registry.json", "utf8")),
);
const item = registryItemSchema.parse(
  JSON.parse(await readFile("public/r/design-sync.json", "utf8")),
);
if (registry.items.length !== 1 || item.type !== "registry:item")
  throw Error("Expected one universal item");
for (const file of item.files ?? []) {
  if (
    !file.target?.startsWith("~/tools/design-sync/") &&
    !file.target?.startsWith("~/docs/design-sync/")
  )
    throw Error(`Unsafe registry target: ${file.target}`);
  if (typeof file.content !== "string")
    throw Error(`Missing bundled content: ${file.path}`);
}
if (!item.devDependencies?.some((d) => d.startsWith("tsx@")))
  throw Error("Missing pinned runner");
console.log(
  `Validated ${item.files?.length} bundled files against shadcn's installed schemas.`,
);
