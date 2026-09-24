import { z } from "zod";
import { DesignSyncError } from "../core/errors.js";
import type { DesignNodeReference, DesignNode } from "../core/types.js";
import type { DesignProvider } from "./types.js";
import { normalizeFigma } from "./normalization.js";
const responseSchema = z.object({
  version: z.string().optional(),
  nodes: z.record(z.string(), z.object({ document: z.unknown() }).nullable()),
});
export class FigmaProvider implements DesignProvider {
  constructor(
    private readonly token = process.env.FIGMA_ACCESS_TOKEN,
    private readonly transport: typeof fetch = fetch,
    private readonly pause = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms)),
  ) {}
  private async request(fileKey: string, ids: string[], version?: string) {
    if (!this.token)
      throw new DesignSyncError(
        "MISSING_TOKEN",
        "Set FIGMA_ACCESS_TOKEN in your shell, root .env, or tools/design-sync/.env. It needs file_content:read access to the configured file.",
      );
    const url = new URL(
      `https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}/nodes`,
    );
    url.searchParams.set("ids", ids.join(","));
    url.searchParams.set("geometry", "paths");
    if (version) url.searchParams.set("version", version);
    for (let attempt = 0; attempt < 3; attempt++) {
      let response: Response;
      try {
        response = await this.transport(url, {
          headers: { "X-Figma-Token": this.token },
          signal: AbortSignal.timeout(30_000),
        });
      } catch {
        if (attempt < 2) {
          await this.pause(500 * 2 ** attempt);
          continue;
        }
        throw new DesignSyncError(
          "NETWORK_FAILURE",
          "Figma request failed or timed out. Check your connection and retry.",
          { fileKey },
        );
      }
      if (response.status === 401 || response.status === 403)
        throw new DesignSyncError(
          "FIGMA_ACCESS_DENIED",
          "Figma rejected access. Check token expiry, file_content:read scope, and file permissions.",
          { fileKey },
        );
      if (response.status === 404)
        throw new DesignSyncError(
          "FIGMA_FILE_INACCESSIBLE",
          "Figma file was not found or is inaccessible. Verify the file key and permissions.",
          { fileKey },
        );
      if (response.status === 429 || response.status >= 500) {
        const header = response.headers.get("retry-after");
        const seconds = header ? Number(header) : NaN;
        const dateDelay = header ? Date.parse(header) - Date.now() : NaN;
        const delay = Number.isFinite(seconds)
          ? seconds * 1000
          : Number.isFinite(dateDelay)
            ? Math.max(0, dateDelay)
            : 500 * 2 ** attempt;
        if (attempt === 2 || delay > 10_000)
          throw new DesignSyncError(
            response.status === 429 ? "FIGMA_RATE_LIMIT" : "FIGMA_UNAVAILABLE",
            "Figma cannot serve this request now. Retry later; cached status remains available.",
            {
              fileKey,
              retryAfterSeconds: Math.max(0, Math.ceil(delay / 1000)),
            },
          );
        await this.pause(Math.max(0, delay));
        continue;
      }
      if (!response.ok)
        throw new DesignSyncError(
          "FIGMA_REQUEST_FAILED",
          `Figma returned HTTP ${response.status}. Check file and node IDs.`,
          { fileKey },
        );
      try {
        const data = responseSchema.parse(await response.json());
        for (const id of ids)
          if (!(id in data.nodes)) throw new Error("Missing requested key");
        if (version && data.version && data.version !== version)
          throw new Error("Mixed versions");
        return data;
      } catch {
        throw new DesignSyncError(
          "INVALID_PROVIDER_DATA",
          "Figma returned incomplete or incompatible node data. No observation was saved.",
          { fileKey },
        );
      }
    }
    throw new DesignSyncError(
      "FIGMA_UNAVAILABLE",
      "Figma request exhausted its retry budget.",
    );
  }
  async getNodes(references: DesignNodeReference[], version?: string) {
    const fileKeys = [...new Set(references.map((r) => r.fileKey))];
    if (fileKeys.length > 1)
      throw new DesignSyncError(
        "INVALID_REFERENCE",
        "V1 requests must use one Figma file.",
      );
    if (!fileKeys.length) return { nodes: {} };
    const ids = [...new Set(references.map((r) => r.nodeId))],
      batches: string[][] = [];
    let batch: string[] = [];
    for (const id of ids) {
      if (
        batch.length >= 50 ||
        encodeURIComponent([...batch, id].join(",")).length > 6000
      ) {
        batches.push(batch);
        batch = [];
      }
      if (encodeURIComponent(id).length > 6000)
        throw new DesignSyncError(
          "INVALID_REFERENCE",
          "Node ID exceeds request limit.",
        );
      batch.push(id);
    }
    if (batch.length) batches.push(batch);
    const nodes: Record<string, DesignNode | null> = {};
    const first = await this.request(fileKeys[0]!, batches[0]!, version);
    const observedVersion = version ?? first.version;
    const ingest = (
      data: z.infer<typeof responseSchema>,
      requested: string[],
    ) => {
      for (const id of requested) {
        const raw = data.nodes[id];
        let node: DesignNode | null;
        try {
          node = raw ? normalizeFigma(raw.document) : null;
        } catch {
          throw new DesignSyncError(
            "INVALID_PROVIDER_DATA",
            `Figma node ${id} contains malformed properties. No observation was saved.`,
            { fileKey: fileKeys[0], nodeId: id },
          );
        }
        if (node && node.id !== id)
          throw new DesignSyncError(
            "INVALID_PROVIDER_DATA",
            "Figma returned a mismatched node identity.",
          );
        nodes[id] = node;
      }
    };
    ingest(first, batches[0]!);
    if (batches.length > 1 && !observedVersion)
      throw new DesignSyncError(
        "INCONSISTENT_OBSERVATION",
        "Figma did not return a version for a multi-request scan. Narrow the selected roots and retry.",
      );
    for (let offset = 1; offset < batches.length; offset += 2)
      await Promise.all(
        batches
          .slice(offset, offset + 2)
          .map(async (group) =>
            ingest(
              await this.request(fileKeys[0]!, group, observedVersion),
              group,
            ),
          ),
      );
    return { nodes, ...(observedVersion ? { version: observedVersion } : {}) };
  }
  async getNode(reference: DesignNodeReference) {
    return (await this.getNodes([reference])).nodes[reference.nodeId] ?? null;
  }
}
