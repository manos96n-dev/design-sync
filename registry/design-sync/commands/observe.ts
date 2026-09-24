import {
  cacheSchema,
  type Config,
  type Manifest,
  type Report,
  type Cache,
  type NodeResult,
} from "../core/schemas.js";
import { hash, identity, designRevision } from "../core/hashing.js";
import { asUnit } from "../core/normalization.js";
import { classifyStatus } from "../core/classifier.js";
import { diffDesign } from "../core/diff.js";
import { DesignSyncError, errorInfo } from "../core/errors.js";
import type { DesignNode, DesignNodeReference } from "../core/types.js";
import type { DesignProvider } from "../providers/types.js";
import {
  atomicJson,
  loadBaseline,
  loadState,
  readJson,
  statePath,
  withLock,
} from "../storage/state.js";
import { codeRevision } from "../storage/paths.js";
export const referenceFor = (
  config: Config,
  nodeId: string,
): DesignNodeReference => {
  if (!nodeId.trim() || !config.figma.fileKey.trim())
    throw new DesignSyncError(
      "INVALID_REFERENCE",
      "A nonempty Figma file key and node ID are required.",
    );
  return { provider: "figma", fileKey: config.figma.fileKey, nodeId };
};
export function configRevision(config: Config) {
  return hash({
    provider: config.provider,
    figma: config.figma,
    tracking: config.tracking,
  });
}
export function validateTracking(config: Config, manifest: Manifest) {
  if (!config.figma.fileKey)
    throw new DesignSyncError(
      "SETUP_REQUIRED",
      "Set figma.fileKey in .design-sync/config.json.",
    );
  if (
    !config.tracking.roots.length &&
    !config.tracking.include.length &&
    !Object.keys(manifest.nodes).length
  )
    throw new DesignSyncError(
      "TRACKING_REQUIRED",
      "Configure tracking.roots or tracking.include, or register an explicit node. An empty scope never scans the entire file.",
    );
}
export async function observe(
  config: Config,
  manifest: Manifest,
  provider: DesignProvider,
): Promise<Cache> {
  validateTracking(config, manifest);
  const roots = [...new Set(config.tracking.roots)];
  const explicit = [
    ...new Set([
      ...config.tracking.include,
      ...Object.values(manifest.nodes).map((n) => n.reference.nodeId),
    ]),
  ];
  const initialIds = roots.length ? roots : explicit;
  const first = await provider.getNodes(
    initialIds.map((id) => referenceFor(config, id)),
  );
  const all = new Map<string, DesignNode>(),
    selected: Record<string, DesignNode | null> = {};
  function index(node: DesignNode) {
    all.set(node.id, node);
    for (const child of node.children) index(child);
  }
  for (const node of Object.values(first.nodes)) if (node) index(node);
  function discover(node: DesignNode) {
    if (config.tracking.exclude.includes(node.id)) {
      selected[node.id] = asUnit(node);
      return;
    }
    if (
      config.tracking.nodeTypes.includes(
        node.type as Config["tracking"]["nodeTypes"][number],
      )
    ) {
      selected[node.id] = asUnit(node);
      return;
    }
    for (const child of node.children) discover(child);
  }
  for (const id of roots) {
    const node = all.get(id);
    if (!node)
      throw new DesignSyncError(
        "TRACKING_ROOT_MISSING",
        `Tracking root ${id} is missing. Update tracking.roots or restore access.`,
      );
    // Page/section roots are containers; explicit include can track the root itself.
    for (const child of node.children) discover(child);
  }
  const missing = explicit.filter((id) => !all.has(id) && !(id in first.nodes));
  if (missing.length) {
    if (!first.version)
      throw new DesignSyncError(
        "INCONSISTENT_OBSERVATION",
        "Cannot fetch additional nodes without a pinned Figma version.",
      );
    const extra = await provider.getNodes(
      missing.map((id) => referenceFor(config, id)),
      first.version,
    );
    for (const node of Object.values(extra.nodes)) if (node) index(node);
  }
  for (const id of explicit)
    selected[id] = all.has(id) ? asUnit(all.get(id)!) : null;
  // Explicit exclusions that exist under fetched roots remain visible as IGNORED.
  for (const id of config.tracking.exclude)
    if (all.has(id)) selected[id] = asUnit(all.get(id)!);
  return {
    version: 1,
    normalizationVersion: 1,
    configRevision: configRevision(config),
    observedAt: new Date().toISOString(),
    ...(first.version ? { fileVersion: first.version } : {}),
    nodes: selected,
  };
}
export async function buildReport(
  root: string,
  config: Config,
  manifest: Manifest,
  cache: Cache,
  source: "cache" | "live",
): Promise<Report> {
  const result: NodeResult[] = [];
  const ids = [
    ...new Set([
      ...Object.keys(cache.nodes),
      ...Object.values(manifest.nodes).map((n) => n.reference.nodeId),
    ]),
  ].sort();
  for (const id of ids) {
    const reference = referenceFor(config, id),
      record = manifest.nodes[identity(reference)],
      node = cache.nodes[id];
    const reasons: string[] = [],
      changes: NodeResult["changes"] = [];
    const ignored = config.tracking.exclude.includes(id);
    let currentCodeRevision: string | undefined;
    if (!node)
      reasons.push(
        id in cache.nodes ? "DESIGN_MISSING" : "OBSERVATION_MISSING",
      );
    if (node?.issues.length) reasons.push(...node.issues);
    if (record?.implementation) {
      try {
        currentCodeRevision = await codeRevision(
          root,
          record.implementation.files,
        );
      } catch (error) {
        reasons.push(errorInfo(error).code);
      }
    }
    if (record?.baseline) {
      try {
        const baseline = await loadBaseline(root, record);
        if (baseline && node) changes.push(...diffDesign(baseline.node, node));
      } catch {
        reasons.push("CORRUPT_OR_INCOMPATIBLE_SNAPSHOT");
      }
    }
    const currentDesignRevision = node ? designRevision(node) : undefined;
    const status = classifyStatus({
      ignored,
      ambiguous: reasons.length > 0,
      exists: Boolean(node),
      hasMapping: Boolean(record?.implementation),
      baselineDesignRevision: record?.baseline?.designRevision,
      baselineCodeRevision: record?.baseline?.codeRevision,
      currentDesignRevision,
      currentCodeRevision,
    });
    if (!record?.implementation) reasons.push("MAPPING_MISSING");
    else if (!record.baseline) reasons.push("BASELINE_MISSING");
    if (status === "NEEDS_REVIEW" && reasons.length === 0)
      reasons.push("BOTH_CHANGED");
    result.push({
      reference,
      nodeId: id,
      name: node?.name ?? record?.name ?? id,
      status,
      ...(record?.implementation?.route !== undefined
        ? { route: record.implementation.route }
        : {}),
      implementationFiles: record?.implementation?.files ?? [],
      ...(record?.baseline
        ? {
            baselineDesignRevision: record.baseline.designRevision,
            baselineCodeRevision: record.baseline.codeRevision,
          }
        : {}),
      ...(currentDesignRevision ? { currentDesignRevision } : {}),
      ...(currentCodeRevision ? { currentCodeRevision } : {}),
      reasons,
      changes,
    });
  }
  const count = (status: NodeResult["status"]) =>
    result.filter((n) => n.status === status).length;
  return {
    observedAt: cache.observedAt,
    freshness: {
      source,
      ageSeconds: Math.max(
        0,
        Math.floor((Date.now() - Date.parse(cache.observedAt)) / 1000),
      ),
    },
    nodes: result,
    summary: {
      implemented: count("IMPLEMENTED"),
      designChanged: count("DESIGN_CHANGED"),
      notImplemented: count("NOT_IMPLEMENTED"),
      codeChanged: count("CODE_CHANGED"),
      needsReview: count("NEEDS_REVIEW"),
      ignored: count("IGNORED"),
    },
  };
}
export async function scan(root: string, provider: DesignProvider) {
  return withLock(root, async () => {
    const { config, manifest } = await loadState(root);
    const cache = await observe(config, manifest, provider);
    const report = await buildReport(root, config, manifest, cache, "live");
    await atomicJson(statePath(root, "cache/observation.json"), cache);
    return report;
  });
}
export async function status(root: string) {
  const { config, manifest } = await loadState(root);
  const cache = await readJson(
    statePath(root, "cache/observation.json"),
    cacheSchema,
  ).catch(() => {
    throw new DesignSyncError(
      "SCAN_REQUIRED",
      "No valid cached observation. Run design:scan first.",
    );
  });
  if (cache.configRevision !== configRevision(config))
    throw new DesignSyncError(
      "SCAN_REQUIRED",
      "Tracking configuration changed. Run design:scan to refresh the observation.",
    );
  return buildReport(root, config, manifest, cache, "cache");
}
