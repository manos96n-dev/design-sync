import { it, expect } from "vitest";
import { mkdtemp, writeFile, readFile, rm, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { migrateFile } from "../registry/design-sync/storage/migrations.js";
it("previews without changing bytes and backs up before applying a registered migration", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "design-sync-migrate-"));
  try {
    const file = path.join(root, "state.json"),
      original = JSON.stringify({ version: 1, custom: { keep: true } });
    const steps = [
      {
        from: 1,
        to: 2,
        apply: (value: Record<string, unknown>) => ({
          ...value,
          added: "value",
        }),
      },
    ];
    await writeFile(file, original);
    const preview = await migrateFile(file, 2, steps, false);
    expect(preview.changed).toBe(true);
    expect(await readFile(file, "utf8")).toBe(original);
    expect(await readdir(root)).toEqual(["state.json"]);
    const result = await migrateFile(file, 2, steps, true);
    if (!("backup" in result)) throw Error("Expected a migration backup");
    expect(result.backup).toBeDefined();
    expect(await readFile(result.backup!, "utf8")).toBe(original);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({
      version: 2,
      custom: { keep: true },
      added: "value",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
