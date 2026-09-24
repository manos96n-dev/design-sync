import { afterEach, beforeEach, expect, it } from "vitest";
import {
  mkdtemp,
  writeFile,
  readFile,
  rm,
  mkdir,
  symlink,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  init,
  register,
  sync,
  migrate,
} from "../registry/design-sync/commands/mutate.js";
import { scan, status } from "../registry/design-sync/commands/observe.js";
import { normalizeFigma } from "../registry/design-sync/providers/normalization.js";
import type { DesignProvider } from "../registry/design-sync/providers/types.js";
import {
  codeRevision,
  resolveRoot,
} from "../registry/design-sync/storage/paths.js";
import {
  loadState,
  statePath,
  withLock,
} from "../registry/design-sync/storage/state.js";
import { reportSchema } from "../registry/design-sync/core/schemas.js";
let root: string;
let width: number;
const provider: DesignProvider = {
  async getNodes(refs) {
    return {
      version: "v1",
      nodes: Object.fromEntries(
        refs.map((ref) => [
          ref.nodeId,
          normalizeFigma({
            id: ref.nodeId,
            name: "Page",
            type: ref.nodeId === "0:1" ? "CANVAS" : "FRAME",
            children:
              ref.nodeId === "0:1"
                ? [
                    {
                      id: "1:1",
                      name: "Screen",
                      type: "FRAME",
                      absoluteBoundingBox: { x: 0, y: 0, width, height: 100 },
                      children: [{ id: "2:1", name: "Nested", type: "FRAME" }],
                    },
                  ]
                : [],
          }),
        ]),
      ),
    };
  },
  async getNode() {
    return normalizeFigma({
      id: "1:1",
      name: "Screen",
      type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width, height: 100 },
      children: [{ id: "2:1", name: "Nested", type: "FRAME" }],
    });
  },
};
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "design-sync-test-"));
  width = 100;
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "fixture",
      scripts: { test: "existing" },
      custom: true,
    }),
  );
  await writeFile(path.join(root, "screen.ts"), "export const value = 1;\n");
  await init(
    root,
    { file: "file", trackingRoots: "0:1" },
    path.join(root, "tools/design-sync/cli.ts"),
  );
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
it("supports the full explicit baseline lifecycle", async () => {
  let report = await scan(root, provider);
  expect(report.nodes).toHaveLength(1);
  expect(report.nodes[0]!.status).toBe("NOT_IMPLEMENTED");
  await register(root, { node: "1:1", files: "screen.ts" });
  expect((await status(root)).nodes[0]!.status).toBe("NOT_IMPLEMENTED");
  await sync(root, "1:1", provider);
  expect((await status(root)).nodes[0]!.status).toBe("IMPLEMENTED");
  width = 120;
  report = await scan(root, provider);
  expect(report.nodes[0]!.status).toBe("DESIGN_CHANGED");
  expect(report.nodes[0]!.changes.some((c) => c.property === "width")).toBe(
    true,
  );
  await writeFile(path.join(root, "screen.ts"), "export const value = 2;\n");
  expect((await status(root)).nodes[0]!.status).toBe("NEEDS_REVIEW");
  await sync(root, "1:1", provider);
  await writeFile(path.join(root, "screen.ts"), "export const value = 3;\n");
  expect((await status(root)).nodes[0]!.status).toBe("CODE_CHANGED");
  expect(reportSchema.safeParse(await status(root)).success).toBe(true);
});
it("does not overwrite state or scripts on repeated initialization", async () => {
  const before = await readFile(statePath(root, "config.json"), "utf8");
  const pkg = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  );
  pkg.scripts["design:status"] = "custom-status";
  await writeFile(path.join(root, "package.json"), JSON.stringify(pkg));
  const result = await init(
    root,
    { file: "different" },
    path.join(root, "tools/design-sync/cli.ts"),
  );
  expect(await readFile(statePath(root, "config.json"), "utf8")).toBe(before);
  expect(
    result.warnings.some(
      (w) => w.includes("custom") || w.includes("conflicting"),
    ),
  ).toBe(true);
  expect(
    JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).scripts
      .test,
  ).toBe("existing");
});
it("preserves baseline through scan failure and rejects replacement without a flag", async () => {
  await register(root, { node: "1:1", files: "screen.ts" });
  await scan(root, provider);
  await sync(root, "1:1", provider);
  const before = await readFile(statePath(root, "manifest.json"), "utf8"),
    cache = await readFile(statePath(root, "cache/observation.json"), "utf8");
  await expect(
    scan(root, {
      ...provider,
      getNodes: async () => {
        throw Error("offline");
      },
    }),
  ).rejects.toThrow();
  expect(await readFile(statePath(root, "manifest.json"), "utf8")).toBe(before);
  expect(
    await readFile(statePath(root, "cache/observation.json"), "utf8"),
  ).toBe(cache);
  await expect(
    register(root, { node: "1:1", files: "screen.ts", route: "/new" }),
  ).rejects.toMatchObject({ code: "DUPLICATE_MAPPING" });
  await register(root, {
    node: "1:1",
    files: "screen.ts",
    route: "/new",
    replace: true,
  });
  expect(
    Object.values((await loadState(root)).manifest.nodes)[0]!.baseline,
  ).toBeUndefined();
});
it("detects missing files and corrupt snapshots without false success", async () => {
  await register(root, { node: "1:1", files: "screen.ts" });
  await scan(root, provider);
  await sync(root, "1:1", provider);
  const record = Object.values((await loadState(root)).manifest.nodes)[0]!;
  await writeFile(statePath(root, record.baseline!.snapshot), "{}");
  expect((await status(root)).nodes[0]!.reasons).toContain(
    "CORRUPT_OR_INCOMPATIBLE_SNAPSHOT",
  );
  await rm(path.join(root, "screen.ts"));
  expect((await status(root)).nodes[0]!.status).toBe("NEEDS_REVIEW");
  await expect(sync(root, "1:1", provider)).rejects.toMatchObject({
    code: "MISSING_IMPLEMENTATION_FILE",
  });
});
it("normalizes CRLF, includes paths and rejects escaping symlinks", async () => {
  const before = await codeRevision(root, ["screen.ts"]);
  await writeFile(path.join(root, "screen.ts"), "export const value = 1;\r\n");
  expect(await codeRevision(root, ["screen.ts"])).toBe(before);
  await writeFile(path.join(root, "other.ts"), "export const value = 1;\n");
  expect(await codeRevision(root, ["other.ts"])).not.toBe(before);
  if (process.platform !== "win32") {
    await symlink(os.tmpdir(), path.join(root, "escape"));
    await expect(
      codeRevision(root, ["escape/nonexistent-file"]),
    ).rejects.toThrow();
  }
});
it("serializes state mutations and releases locks after failure", async () => {
  await withLock(root, async () => {
    await expect(
      register(root, { node: "1:1", files: "screen.ts" }),
    ).rejects.toMatchObject({ code: "STATE_LOCKED" });
  });
  await expect(
    withLock(root, async () => {
      throw Error("stop");
    }),
  ).rejects.toThrow();
  await register(root, { node: "1:1", files: "screen.ts" });
});
it("finds repository state from nested monorepo packages", async () => {
  await mkdir(path.join(root, "apps/web"), { recursive: true });
  expect(await resolveRoot(undefined, path.join(root, "apps/web"))).toBe(
    await resolveRoot(root),
  );
});
it("validates current migrations and refuses unknown versions", async () => {
  expect((await migrate(root, false)).message).toContain("current");
  const file = statePath(root, "manifest.json");
  await writeFile(file, JSON.stringify({ version: 99, nodes: {}, custom: 1 }));
  const before = await readFile(file, "utf8");
  await expect(migrate(root, true)).rejects.toMatchObject({
    code: "UNSUPPORTED_SCHEMA",
  });
  expect(await readFile(file, "utf8")).toBe(before);
});
it("preserves extension data during repeat registration and synchronization", async () => {
  await register(root, { node: "1:1", files: "screen.ts" });
  const file = statePath(root, "manifest.json"),
    manifest = JSON.parse(await readFile(file, "utf8"));
  const key = Object.keys(manifest.nodes)[0]!;
  manifest.custom = { kept: true };
  manifest.nodes[key].implementation.custom = { kept: true };
  await writeFile(file, JSON.stringify(manifest));
  await register(root, { node: "1:1", files: "screen.ts" });
  await sync(root, "1:1", provider);
  const updated = (await loadState(root)).manifest;
  expect(updated.custom).toEqual({ kept: true });
  expect(updated.nodes[key]!.implementation!.custom).toEqual({ kept: true });
});
it("keeps deleted registered nodes visible for review", async () => {
  await register(root, { node: "1:1", files: "screen.ts" });
  await scan(root, provider);
  await sync(root, "1:1", provider);
  const missing: DesignProvider = {
    getNode: async () => null,
    getNodes: async (refs) => ({
      version: "v1",
      nodes: Object.fromEntries(
        refs.map((ref) => [
          ref.nodeId,
          ref.nodeId === "0:1"
            ? normalizeFigma({
                id: "0:1",
                name: "Page",
                type: "CANVAS",
                children: [],
              })
            : null,
        ]),
      ),
    }),
  };
  const report = await scan(root, missing);
  expect(report.nodes[0]!.status).toBe("NEEDS_REVIEW");
  expect(report.nodes[0]!.reasons).toContain("DESIGN_MISSING");
});
it("exclusions win and changed tracking requires a new scan", async () => {
  await scan(root, provider);
  const file = statePath(root, "config.json"),
    config = JSON.parse(await readFile(file, "utf8"));
  config.tracking.exclude = ["1:1"];
  await writeFile(file, JSON.stringify(config));
  await expect(status(root)).rejects.toMatchObject({ code: "SCAN_REQUIRED" });
  expect((await scan(root, provider)).nodes[0]!.status).toBe("IGNORED");
  await register(root, { node: "1:1", files: "screen.ts" });
  await expect(sync(root, "1:1", provider)).rejects.toMatchObject({
    code: "NODE_IGNORED",
  });
});
it("refuses an escaped real symlink target", async () => {
  if (process.platform === "win32") return;
  const outside = await mkdtemp(path.join(os.tmpdir(), "design-sync-outside-"));
  try {
    await writeFile(path.join(outside, "secret.ts"), "outside");
    await symlink(outside, path.join(root, "outside"));
    await expect(
      codeRevision(root, ["outside/secret.ts"]),
    ).rejects.toMatchObject({ code: "INVALID_PATH" });
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});
it("rejects an empty node ID before corrupting the manifest", async () => {
  const before = await readFile(statePath(root, "manifest.json"), "utf8");
  await expect(
    register(root, { node: "", files: "screen.ts" }),
  ).rejects.toMatchObject({ code: "INVALID_REFERENCE" });
  expect(await readFile(statePath(root, "manifest.json"), "utf8")).toBe(before);
});
