import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { expect, it } from "vitest";
import {
  errorEnvelopeSchema,
  successEnvelopeSchema,
} from "../registry/design-sync/core/schemas.js";
const exec = promisify(execFile);
const cli = path.resolve("registry/design-sync/cli.ts");
async function invoke(args: string[]) {
  try {
    const result = await exec(
      process.execPath,
      ["--import", "tsx", cli, ...args],
      { env: { ...process.env, FIGMA_ACCESS_TOKEN: "" } },
    );
    return { ...result, code: 0 };
  } catch (error) {
    const result = error as { stdout: string; stderr: string; code: number };
    return result;
  }
}
it("version produces only a schema-valid JSON document", async () => {
  const result = await invoke(["version", "--json"]);
  expect(result.code).toBe(0);
  expect(result.stderr).toBe("");
  const output = successEnvelopeSchema.parse(JSON.parse(result.stdout));
  expect(output).toMatchObject({
    schemaVersion: 2,
    toolVersion: "0.2.0",
    ok: true,
    result: {
      toolVersion: "0.2.0",
      configVersion: 1,
      manifestVersion: 1,
      snapshotVersion: 1,
      outputVersion: 2,
    },
  });
});
it.each([
  ["sync", "--all"],
  ["sync"],
  ["no-such-command"],
  ["diff", "--bad-option"],
])("invalid arguments fail with one JSON error: %s", async (...args) => {
  const result = await invoke([...args, "--json"]);
  expect(result.code).toBe(2);
  expect(result.stderr).toBe("");
  expect(errorEnvelopeSchema.parse(JSON.parse(result.stdout)).error.code).toBe(
    "INVALID_ARGUMENT",
  );
});
it("an uninitialized project returns an actionable tool error", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "design-sync-cli-"));
  try {
    const result = await invoke(["status", "--root", root, "--json"]);
    expect(result.code).toBe(2);
    expect(errorEnvelopeSchema.parse(JSON.parse(result.stdout)).ok).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
