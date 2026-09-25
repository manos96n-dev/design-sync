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
  agentInstallers,
  init,
  register,
  sync,
  migrate,
} from "../registry/design-sync/commands/mutate.js";
import { scan, status } from "../registry/design-sync/commands/observe.js";
import { buildAgentPlan } from "../registry/design-sync/commands/agent.js";
import { formatReport } from "../registry/design-sync/output/human.js";
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
import {
  agentPlanSchema,
  reportSchema,
} from "../registry/design-sync/core/schemas.js";
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
  await mkdir(path.join(root, "tools/design-sync"), { recursive: true });
  await writeFile(path.join(root, "tools/design-sync/cli.ts"), "// fixture\n");
  await init(
    root,
    { file: "file", trackingRoots: "0:1" },
    path.join(root, "tools/design-sync/cli.ts"),
  );
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
it.runIf(process.platform !== "win32")(
  "canonicalizes an aliased installed CLI path before writing package scripts",
  async () => {
    const realRoot = await mkdtemp(
      path.join(os.tmpdir(), "design-sync-real-root-"),
    );
    const aliasRoot = `${realRoot}-alias`;
    try {
      await mkdir(path.join(realRoot, "tools/design-sync"), {
        recursive: true,
      });
      await writeFile(
        path.join(realRoot, "tools/design-sync/cli.ts"),
        "// fixture\n",
      );
      await writeFile(
        path.join(realRoot, "package.json"),
        JSON.stringify({ name: "aliased-fixture", private: true }),
      );
      await symlink(realRoot, aliasRoot, "dir");
      await init(
        realRoot,
        { file: "file", trackingRoots: "0:1" },
        path.join(aliasRoot, "tools/design-sync/cli.ts"),
      );
      const pkg = JSON.parse(
        await readFile(path.join(realRoot, "package.json"), "utf8"),
      );
      expect(pkg.scripts["design:init"]).toBe(
        'tsx "tools/design-sync/cli.ts" init',
      );
    } finally {
      await rm(aliasRoot, { recursive: true, force: true });
      await rm(realRoot, { recursive: true, force: true });
    }
  },
);
it("installs every supported agent format without overwriting existing instructions", async () => {
  const installed = await init(
    root,
    { agent: "all" },
    path.join(root, "tools/design-sync/cli.ts"),
  );
  expect(installed.agents).toHaveLength(Object.keys(agentInstallers).length);
  expect(installed.agents.every(({ status }) => status === "installed")).toBe(
    true,
  );
  for (const { path: installedPath } of installed.agents) {
    const content = await readFile(path.join(root, installedPath), "utf8");
    expect(content).toContain("tools/design-sync/agents/workflow.md");
  }
  expect(await readFile(path.join(root, "GEMINI.md"), "utf8")).toContain(
    "@tools/design-sync/agents/workflow.md",
  );

  const preserved = await init(
    root,
    { agent: "claude-code,github-copilot,gemini-cli,devin,roo-code,agents" },
    path.join(root, "tools/design-sync/cli.ts"),
  );
  expect(preserved.agents.map(({ agent }) => agent)).toEqual([
    "claude",
    "copilot",
    "gemini",
    "windsurf",
    "roo",
    "agents-md",
  ]);
  expect(preserved.agents.every(({ status }) => status === "preserved")).toBe(
    true,
  );
});
it("supports the full explicit baseline lifecycle", async () => {
  let report = await scan(root, provider);
  expect(report.nodes).toHaveLength(1);
  expect(report.nodes[0]!.status).toBe("NOT_IMPLEMENTED");
  expect(report.summary.coverage).toEqual({
    active: 1,
    mappedToCode: 0,
    mappedAwaitingBaseline: 0,
    acceptedBaselines: 0,
    unmapped: 1,
  });
  const concise = formatReport(report);
  expect(concise).toContain("0/1 active designs mapped to code (0%)");
  expect(concise).toContain("Unmapped · Not ready or unmarked (1)");
  expect(concise.indexOf("Implementation coverage")).toBeLessThan(
    concise.indexOf("Needs attention"),
  );
  expect(formatReport(report, { showAll: true })).toContain(
    "All tracked nodes",
  );
  await register(root, { node: "1:1", files: "screen.ts" });
  report = await status(root);
  expect(report.nodes[0]!.status).toBe("MAPPED_AWAITING_BASELINE");
  expect(report.summary).toMatchObject({
    acceptedAndMatching: 0,
    notImplemented: 0,
    mappedAwaitingBaseline: 1,
  });
  expect(formatReport(report)).toContain("Mapped · Baseline not accepted (1)");
  expect(report.summary.coverage).toEqual({
    active: 1,
    mappedToCode: 1,
    mappedAwaitingBaseline: 1,
    acceptedBaselines: 0,
    unmapped: 0,
  });
  await sync(root, "1:1", provider);
  report = await status(root);
  expect(report.nodes[0]!.status).toBe("IMPLEMENTED");
  expect(report.summary).toMatchObject({
    acceptedAndMatching: 1,
    notImplemented: 0,
    mappedAwaitingBaseline: 0,
  });
  expect(report.summary.coverage).toEqual({
    active: 1,
    mappedToCode: 1,
    mappedAwaitingBaseline: 0,
    acceptedBaselines: 1,
    unmapped: 0,
  });
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
it("prepares an approval-gated agent handoff without starting an agent", async () => {
  const report = await scan(root, provider);
  const plan = buildAgentPlan(report);
  expect(agentPlanSchema.parse(plan)).toEqual(plan);
  expect(plan.agentStarted).toBe(false);
  expect(plan.recommendation).toBe("START_AGENT");
  expect(plan.approval).toMatchObject({
    requiredBeforeAgentStart: true,
    granted: false,
    tokenUsageNotice: true,
  });
  expect(plan.approval.question).toContain("model token allowance");
  expect(plan.mappingCandidateCount).toBe(1);
  expect(plan.readiness).toEqual({
    readyForDev: 0,
    completed: 0,
    none: 1,
    unknown: 0,
  });
  expect(plan.mappingCandidates[0]!.nodeId).toBe("1:1");
  expect(plan.promptAfterApproval).toContain("explicitly approved");
  expect(plan.copyablePrompt).toContain(
    "Do not start, spawn, delegate to, or perform",
  );
  expect(plan.copyablePrompt).toContain("model token allowance");
  expect(plan.copyablePrompt).toContain("figmaCompletionApproval.question");
  expect(plan.figmaCompletionApproval).toMatchObject({
    requiredBeforeWrite: true,
    granted: false,
    defaultAction: "LEAVE_FIGMA_UNCHANGED",
    cliCanWrite: false,
  });
  expect(plan.figmaCompletionApproval.question).toContain(
    "mark these exact Figma nodes as Completed",
  );
  expect((await status(root)).nodes[0]!.devStatus).toBeNull();

  await register(root, { node: "1:1", files: "screen.ts" });
  const emptyPlan = buildAgentPlan(await status(root));
  expect(emptyPlan).toMatchObject({
    agentStarted: false,
    recommendation: "NO_ACTION",
    mappingCandidateCount: 0,
    readiness: {
      readyForDev: 0,
      completed: 0,
      none: 0,
      unknown: 0,
    },
    approval: {
      requiredBeforeAgentStart: false,
      granted: false,
      tokenUsageNotice: false,
    },
  });
  expect(emptyPlan).not.toHaveProperty("promptAfterApproval");
  expect(emptyPlan).not.toHaveProperty("copyablePrompt");
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
  const ignored = (await scan(root, provider)).nodes[0]!;
  expect(ignored.status).toBe("IGNORED");
  expect(ignored.reasons).toEqual(["INTENTIONALLY_EXCLUDED"]);
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
