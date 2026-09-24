import path from "node:path";
import { mkdir, readFile, writeFile, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { DesignSyncError } from "../core/errors.js";
import {
  configSchema,
  manifestSchema,
  snapshotSchema,
  type Config,
  type Manifest,
  type NodeRecord,
} from "../core/schemas.js";
import { designRevision, identity } from "../core/hashing.js";
import { safeFile } from "./paths.js";
export const statePath = (root: string, file: string) =>
  path.join(root, ".design-sync", file);
export async function readJson<T>(
  file: string,
  schema: z.ZodType<T>,
): Promise<T> {
  try {
    return schema.parse(JSON.parse(await readFile(file, "utf8")));
  } catch (error) {
    throw new DesignSyncError(
      "INVALID_STATE",
      `Cannot read or validate ${file}. Check its schema version and JSON; run design:migrate for supported upgrades.`,
      {
        cause:
          error instanceof z.ZodError
            ? error.issues
                .map((i) => `${i.path.join(".")}: ${i.message}`)
                .join("; ")
            : ((error as NodeJS.ErrnoException).code ?? "Invalid JSON"),
      },
    );
  }
}
export async function atomicJson(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", {
      flag: "wx",
    });
    await rename(temporary, file);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}
export async function withLock<T>(
  root: string,
  fn: () => Promise<T>,
): Promise<T> {
  await mkdir(statePath(root, ""), { recursive: true });
  const lock = statePath(root, "write.lock");
  try {
    await writeFile(
      lock,
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
      { flag: "wx" },
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    throw new DesignSyncError(
      "STATE_LOCKED",
      `Another operation owns ${lock}. If it crashed, verify the recorded process has stopped before removing this lock.`,
    );
  }
  try {
    return await fn();
  } finally {
    await unlink(lock);
  }
}
export async function loadState(
  root: string,
): Promise<{ config: Config; manifest: Manifest }> {
  const config = await readJson(statePath(root, "config.json"), configSchema);
  const manifest = await readJson(
    statePath(root, "manifest.json"),
    manifestSchema,
  );
  for (const [key, record] of Object.entries(manifest.nodes)) {
    if (
      key !== identity(record.reference) ||
      record.reference.fileKey !== config.figma.fileKey
    )
      throw new DesignSyncError(
        "INVALID_MANIFEST",
        "Manifest identity or fileKey does not match configuration. Restore the original configuration or explicitly migrate project state.",
      );
  }
  return { config, manifest };
}
export async function loadBaseline(root: string, record: NodeRecord) {
  if (!record.baseline) return undefined;
  const expectedPrefix = `snapshots/${identity(record.reference)}/`;
  if (!record.baseline.snapshot.startsWith(expectedPrefix))
    throw new DesignSyncError(
      "CORRUPT_SNAPSHOT",
      "Snapshot path does not match node identity.",
    );
  const file = await safeFile(statePath(root, ""), record.baseline.snapshot);
  const snapshot = await readJson(file, snapshotSchema);
  if (
    identity(snapshot.reference) !== identity(record.reference) ||
    snapshot.node.id !== record.reference.nodeId ||
    designRevision(snapshot.node) !== record.baseline.designRevision ||
    snapshot.designRevision !== record.baseline.designRevision
  )
    throw new DesignSyncError(
      "CORRUPT_SNAPSHOT",
      "Snapshot identity or hash does not match the baseline. Restore the committed snapshot.",
    );
  return snapshot;
}
