import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { configSchema, cacheSchema, type NodeRecord } from "../core/schemas.js";
import { DesignSyncError } from "../core/errors.js";
import { identity, designRevision, stableSerialize } from "../core/hashing.js";
import { asUnit } from "../core/normalization.js";
import {
  atomicJson,
  loadState,
  statePath,
  withLock,
  loadBaseline,
  readJson,
} from "../storage/state.js";
import { codeRevision, exists, normalizePath } from "../storage/paths.js";
import { migrateFile } from "../storage/migrations.js";
import type { DesignProvider } from "../providers/types.js";
import { configRevision, referenceFor } from "./observe.js";
const commandNames = [
  "init",
  "register",
  "scan",
  "status",
  "diff",
  "sync",
  "check",
  "migrate",
  "version",
];
export async function init(
  root: string,
  options: { file?: string; trackingRoots?: string; agent?: string },
  cliPath: string,
) {
  if (options.agent && !["codex", "claude", "cursor"].includes(options.agent))
    throw new DesignSyncError(
      "INVALID_AGENT",
      "Choose codex, claude, or cursor.",
    );
  const warnings: string[] = [];
  return withLock(root, async () => {
    const configFile = statePath(root, "config.json");
    if (!(await exists(configFile)))
      await atomicJson(
        configFile,
        configSchema.parse({
          version: 1,
          provider: "figma",
          figma: { fileKey: options.file ?? "" },
          tracking: { roots: splitList(options.trackingRoots ?? "") },
        }),
      );
    if (!(await exists(statePath(root, "manifest.json"))))
      await atomicJson(statePath(root, "manifest.json"), {
        version: 1,
        nodes: {},
      });
    const { config } = await loadState(root);
    await mkdir(statePath(root, "snapshots"), { recursive: true });
    const ignore = statePath(root, ".gitignore");
    const oldIgnore = (await exists(ignore))
      ? await readFile(ignore, "utf8")
      : "";
    const rules = ["cache/", "write.lock", "*.tmp"];
    const missing = rules.filter(
      (rule) => !oldIgnore.split(/\r?\n/).includes(rule),
    );
    if (missing.length)
      await writeFile(
        ignore,
        oldIgnore +
          (oldIgnore && !oldIgnore.endsWith("\n") ? "\n" : "") +
          missing.join("\n") +
          "\n",
      );
    const pkgFile = path.join(root, "package.json");
    if (await exists(pkgFile)) {
      const pkg = z
        .object({ scripts: z.record(z.string(), z.string()).optional() })
        .passthrough()
        .parse(JSON.parse(await readFile(pkgFile, "utf8")));
      const relativeCli = normalizePath(path.relative(root, cliPath));
      const scripts = { ...pkg.scripts };
      for (const name of commandNames) {
        const key = `design:${name}`,
          value = `tsx ${JSON.stringify(relativeCli)} ${name}`;
        if (scripts[key] && scripts[key] !== value)
          warnings.push(`Preserved conflicting ${key}. Run directly: ${value}`);
        else scripts[key] = value;
      }
      if (stableSerialize(scripts) !== stableSerialize(pkg.scripts ?? {}))
        await atomicJson(pkgFile, { ...pkg, scripts });
    } else
      warnings.push(
        "No root package.json found. Invoke the installed CLI directly with tsx.",
      );
    if (options.agent) {
      const destinations: Record<string, string> = {
        codex: ".agents/skills/design-sync/SKILL.md",
        claude: ".claude/skills/design-sync/SKILL.md",
        cursor: ".cursor/rules/design-sync.mdc",
      };
      const destination = path.join(root, destinations[options.agent]!);
      const relativeGuide = path
        .relative(
          path.dirname(destination),
          path.join(root, "tools/design-sync/agents/workflow.md"),
        )
        .replaceAll("\\", "/");
      const frontmatter =
        options.agent === "cursor"
          ? "---\ndescription: Design Sync implementation workflow\nalwaysApply: false\n---\n"
          : "---\nname: design-sync\ndescription: Discover design changes, update implementations, verify, then explicitly synchronize one node.\n---\n";
      await mkdir(path.dirname(destination), { recursive: true });
      try {
        await writeFile(
          destination,
          `${frontmatter}\nRead and follow [the canonical workflow](${relativeGuide}).\n`,
          { flag: "wx" },
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        warnings.push(`Preserved existing agent instructions: ${destination}`);
      }
    }
    if (!config.figma.fileKey)
      warnings.push(
        "Set figma.fileKey in .design-sync/config.json before scanning.",
      );
    if (!process.env.FIGMA_ACCESS_TOKEN)
      warnings.push("Set FIGMA_ACCESS_TOKEN before live Figma commands.");
    return { root, initialized: true, warnings };
  });
}
export function splitList(value: string) {
  return [
    ...new Set(
      value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}
export async function register(
  root: string,
  options: {
    node: string;
    files: string;
    route?: string;
    story?: string;
    test?: string;
    name?: string;
    replace?: boolean;
  },
) {
  return withLock(root, async () => {
    const { config, manifest } = await loadState(root);
    if (!config.figma.fileKey)
      throw new DesignSyncError(
        "SETUP_REQUIRED",
        "Configure figma.fileKey before registering a node.",
      );
    const files = [
      ...new Set(splitList(options.files).map(normalizePath)),
    ].sort();
    await codeRevision(root, files);
    const reference = referenceFor(config, options.node),
      key = identity(reference),
      previous = manifest.nodes[key];
    const extensions = { ...previous?.implementation };
    for (const field of ["files", "route", "story", "test"])
      delete extensions[field];
    const implementation = {
      ...extensions,
      files,
      ...(options.route !== undefined ? { route: options.route } : {}),
      ...(options.story !== undefined ? { story: options.story } : {}),
      ...(options.test !== undefined ? { test: options.test } : {}),
    };
    const changed =
      previous?.implementation &&
      stableSerialize(previous.implementation) !==
        stableSerialize(implementation);
    if (changed && !options.replace)
      throw new DesignSyncError(
        "DUPLICATE_MAPPING",
        "This node already has a different mapping. Use --replace to change it and invalidate its baseline.",
      );
    const record: NodeRecord = {
      ...previous,
      reference,
      name: options.name ?? previous?.name ?? options.node,
      type: previous?.type ?? "UNKNOWN",
      implementation,
    };
    if (changed) delete record.baseline;
    manifest.nodes[key] = record;
    await atomicJson(statePath(root, "manifest.json"), manifest);
    return {
      reference,
      implementation,
      baselineEstablished: false,
      baselinePreserved: Boolean(record.baseline),
    };
  });
}
export async function sync(
  root: string,
  nodeId: string,
  provider: DesignProvider,
) {
  return withLock(root, async () => {
    const { config, manifest } = await loadState(root);
    const reference = referenceFor(config, nodeId),
      key = identity(reference),
      record = manifest.nodes[key];
    if (config.tracking.exclude.includes(nodeId))
      throw new DesignSyncError(
        "NODE_IGNORED",
        "Remove the node from tracking.exclude before synchronizing.",
      );
    if (!record?.implementation)
      throw new DesignSyncError(
        "MAPPING_REQUIRED",
        "Register implementation files before synchronizing this node.",
      );
    const fetched = await provider.getNode(reference);
    if (!fetched)
      throw new DesignSyncError(
        "DESIGN_MISSING",
        `Figma node ${nodeId} does not exist in file ${reference.fileKey}. Verify its identity; no baseline was changed.`,
      );
    const node = asUnit(fetched);
    if (node.issues.length)
      throw new DesignSyncError(
        "UNSUPPORTED_DESIGN",
        "Design contains unsupported structures; synchronization was refused.",
        { issues: node.issues },
      );
    const design = designRevision(node),
      code = await codeRevision(root, record.implementation.files);
    const snapshot = `snapshots/${key}/${design.slice(7)}.json`;
    const snapshotFile = statePath(root, snapshot);
    if (await exists(snapshotFile))
      await loadBaseline(root, {
        ...record,
        baseline: {
          designRevision: design,
          codeRevision: code,
          snapshot,
          lastSyncedAt: new Date().toISOString(),
        },
      });
    else
      await atomicJson(snapshotFile, {
        version: 1,
        normalizationVersion: 1,
        reference,
        designRevision: design,
        node,
      });
    // Fail before committing if files changed while preparing the snapshot.
    if (code !== (await codeRevision(root, record.implementation.files)))
      throw new DesignSyncError(
        "CODE_CHANGED_DURING_SYNC",
        "Implementation files changed during synchronization. Verify and retry.",
      );
    record.name = node.name;
    record.type = node.type;
    record.baseline = {
      ...record.baseline,
      designRevision: design,
      codeRevision: code,
      snapshot,
      lastSyncedAt: new Date().toISOString(),
    };

    // Keep other nodes and the conservative observation age; never fabricate a full scan.
    const cacheFile = statePath(root, "cache/observation.json");
    const cache = await readJson(cacheFile, cacheSchema).catch(() => undefined);
    if (cache && cache.configRevision === configRevision(config)) {
      cache.nodes[nodeId] = node;
      delete cache.fileVersion; // This cache can now contain observations from different file versions.
      await atomicJson(cacheFile, cache);
    }
    await atomicJson(statePath(root, "manifest.json"), manifest);
    return {
      reference,
      name: node.name,
      synchronized: true,
      ...record.baseline,
    };
  });
}
export async function migrate(root: string, apply: boolean) {
  return withLock(root, async () => {
    // V1 deliberately has no invented historical migration. Unknown versions fail closed.
    const files = ["config.json", "manifest.json"];
    const results = [];
    for (const file of files)
      results.push(await migrateFile(statePath(root, file), 1, [], apply));
    const { manifest } = await loadState(root);
    for (const node of Object.values(manifest.nodes))
      if (node.baseline) await loadBaseline(root, node);
    return {
      applied: apply,
      migrations: results,
      message: "V1 state is current. No migration required.",
    };
  });
}
export const installedCli = fileURLToPath(
  new URL("../cli.ts", import.meta.url),
);
