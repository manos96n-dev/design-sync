import { expect, it } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { registryFiles } from "../scripts/registry-files.js";
it("never distributes local environment files", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "design-sync-distribution-"),
  );
  try {
    for (const name of [
      ".env",
      ".env.local",
      ".env.production",
      ".env.example",
      "cli.ts",
    ])
      await writeFile(path.join(root, name), "fixture");
    expect(
      (await registryFiles(root)).map((file) => path.basename(file)),
    ).toEqual([".env.example", "cli.ts"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
