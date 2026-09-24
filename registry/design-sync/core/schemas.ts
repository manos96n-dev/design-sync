import { z } from "zod";
import { STATUSES, type DesignNode } from "./types.js";
export const statusSchema = z.enum(STATUSES);
const nodeId = z.string().min(1);
export const referenceSchema = z.object({
  provider: z.literal("figma"),
  fileKey: z.string().min(1),
  nodeId,
});
export const revisionSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const configSchema = z
  .object({
    version: z.literal(1),
    provider: z.literal("figma"),
    figma: z.object({ fileKey: z.string() }).passthrough(),
    tracking: z
      .object({
        roots: z.array(nodeId).default([]),
        include: z.array(nodeId).default([]),
        exclude: z.array(nodeId).default([]),
        nodeTypes: z
          .array(
            z.enum([
              "FRAME",
              "COMPONENT",
              "COMPONENT_SET",
              "INSTANCE",
              "SECTION",
            ]),
          )
          .min(1)
          .default(["FRAME", "COMPONENT", "COMPONENT_SET"]),
      })
      .passthrough(),
    ci: z
      .object({ failOn: z.array(statusSchema).default(["NEEDS_REVIEW"]) })
      .passthrough()
      .default({ failOn: ["NEEDS_REVIEW"] }),
  })
  .passthrough();
export const implementationSchema = z
  .object({
    files: z.array(z.string().min(1)).min(1),
    route: z.string().optional(),
    story: z.string().optional(),
    test: z.string().optional(),
  })
  .passthrough();
export const baselineSchema = z
  .object({
    designRevision: revisionSchema,
    codeRevision: revisionSchema,
    snapshot: z.string().min(1),
    lastSyncedAt: z.iso.datetime(),
  })
  .passthrough();
export const recordSchema = z
  .object({
    reference: referenceSchema,
    name: z.string(),
    type: z.string(),
    implementation: implementationSchema.optional(),
    baseline: baselineSchema.optional(),
  })
  .passthrough();
export const manifestSchema = z
  .object({ version: z.literal(1), nodes: z.record(z.string(), recordSchema) })
  .passthrough();
export const designNodeSchema: z.ZodType<DesignNode> = z.lazy(() =>
  z.object({
    id: nodeId,
    name: z.string(),
    type: z.string(),
    properties: z.record(z.string(), z.json()),
    children: z.array(designNodeSchema),
    issues: z.array(z.string()),
  }),
);
export const snapshotSchema = z
  .object({
    version: z.literal(1),
    normalizationVersion: z.literal(1),
    reference: referenceSchema,
    designRevision: revisionSchema,
    node: designNodeSchema,
  })
  .passthrough();
export const cacheSchema = z.object({
  version: z.literal(1),
  normalizationVersion: z.literal(1),
  configRevision: revisionSchema,
  observedAt: z.iso.datetime(),
  fileVersion: z.string().optional(),
  nodes: z.record(z.string(), designNodeSchema.nullable()),
});
export const changeSchema = z.object({
  type: z.enum(["ADDED", "REMOVED", "MODIFIED"]),
  path: z.string(),
  label: z.string(),
  property: z.string().optional(),
  before: z.json().optional(),
  after: z.json().optional(),
});
export const nodeResultSchema = z.object({
  reference: referenceSchema,
  nodeId,
  name: z.string(),
  status: statusSchema,
  route: z.string().optional(),
  implementationFiles: z.array(z.string()),
  baselineDesignRevision: revisionSchema.optional(),
  currentDesignRevision: revisionSchema.optional(),
  baselineCodeRevision: revisionSchema.optional(),
  currentCodeRevision: revisionSchema.optional(),
  reasons: z.array(z.string()),
  changes: z.array(changeSchema),
});
export const reportSchema = z.object({
  observedAt: z.iso.datetime(),
  freshness: z.object({
    source: z.enum(["cache", "live"]),
    ageSeconds: z.number().nonnegative(),
  }),
  nodes: z.array(nodeResultSchema),
  summary: z.object({
    implemented: z.number(),
    designChanged: z.number(),
    notImplemented: z.number(),
    codeChanged: z.number(),
    needsReview: z.number(),
    ignored: z.number(),
  }),
});
const envelope = {
  schemaVersion: z.literal(1),
  toolVersion: z.string(),
  command: z.string(),
};
export const errorEnvelopeSchema = z.object({
  ...envelope,
  ok: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.string(), z.json()),
  }),
});
export const successEnvelopeSchema = z.object({
  ...envelope,
  ok: z.literal(true),
  result: z.json(),
});
export const reportEnvelopeSchema = z.object({
  ...envelope,
  ok: z.literal(true),
  result: reportSchema,
});
export type Config = z.infer<typeof configSchema>;
export type Manifest = z.infer<typeof manifestSchema>;
export type NodeRecord = z.infer<typeof recordSchema>;
export type Cache = z.infer<typeof cacheSchema>;
export type Report = z.infer<typeof reportSchema>;
export type NodeResult = z.infer<typeof nodeResultSchema>;
