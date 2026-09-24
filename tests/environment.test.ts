import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadFigmaEnvironment } from "../registry/design-sync/storage/environment.js";
let root: string, toolkit: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "design-sync-env-"));
  toolkit = path.join(root, "tools/design-sync");
  await mkdir(toolkit, { recursive: true });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
it("reads a quoted root token without loading application variables", async () => {
  await writeFile(
    path.join(root, ".env"),
    'export FIGMA_ACCESS_TOKEN="fixture#token"\nDATABASE_URL=unrelated\n',
  );
  const environment: NodeJS.ProcessEnv = {};
  await loadFigmaEnvironment(root, environment, toolkit);
  expect(environment).toEqual({ FIGMA_ACCESS_TOKEN: "fixture#token" });
});
it.each(["exported", ""])("preserves exported value %j", async (token) => {
  await writeFile(path.join(root, ".env"), "FIGMA_ACCESS_TOKEN=root\n");
  const environment = { FIGMA_ACCESS_TOKEN: token };
  await loadFigmaEnvironment(root, environment, toolkit);
  expect(environment.FIGMA_ACCESS_TOKEN).toBe(token);
});
it("prefers the root dotenv over the toolkit dotenv", async () => {
  await writeFile(path.join(root, ".env"), "FIGMA_ACCESS_TOKEN=root\n");
  await writeFile(path.join(toolkit, ".env"), "FIGMA_ACCESS_TOKEN=toolkit\n");
  const environment: NodeJS.ProcessEnv = {};
  await loadFigmaEnvironment(root, environment, toolkit);
  expect(environment.FIGMA_ACCESS_TOKEN).toBe("root");
});
it("uses toolkit dotenv when the root has no token", async () => {
  await writeFile(path.join(root, ".env"), "APP=value\n");
  await writeFile(path.join(toolkit, ".env"), "FIGMA_ACCESS_TOKEN=toolkit\n");
  const environment: NodeJS.ProcessEnv = {};
  await loadFigmaEnvironment(root, environment, toolkit);
  expect(environment).toEqual({ FIGMA_ACCESS_TOKEN: "toolkit" });
});
it("allows missing dotenv files", async () => {
  const environment: NodeJS.ProcessEnv = {};
  await loadFigmaEnvironment(root, environment, toolkit);
  expect(environment).toEqual({});
});
it("reports an unreadable dotenv without including its contents", async () => {
  await mkdir(path.join(root, ".env"));
  await expect(loadFigmaEnvironment(root, {}, toolkit)).rejects.toMatchObject({
    code: "ENV_FILE_UNREADABLE",
  });
});
