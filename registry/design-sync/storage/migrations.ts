import { DesignSyncError } from "../core/errors.js";
import { atomicJson } from "./state.js";
import { readFile, copyFile } from "node:fs/promises";
export type Migration = {
  from: number;
  to: number;
  apply: (value: Record<string, unknown>) => Record<string, unknown>;
};
export function migrateValue(
  value: Record<string, unknown>,
  target: number,
  steps: Migration[],
) {
  const current = value.version;
  if (
    typeof current !== "number" ||
    !Number.isInteger(current) ||
    current > target
  )
    throw new DesignSyncError(
      "UNSUPPORTED_SCHEMA",
      "Unsupported schema version. Upgrade Design Sync or restore supported state.",
    );
  let result = structuredClone(value);
  while (result.version !== target) {
    const step = steps.find(
      (s) => s.from === result.version && s.to === s.from + 1,
    );
    if (!step)
      throw new DesignSyncError(
        "UNSUPPORTED_SCHEMA",
        `No migration from schema ${String(result.version)} is available.`,
      );
    result = {
      ...result,
      ...step.apply(structuredClone(result)),
      version: step.to,
    };
  }
  return result;
}
export async function migrateFile(
  file: string,
  target: number,
  steps: Migration[],
  apply: boolean,
) {
  const original = JSON.parse(await readFile(file, "utf8")) as Record<
    string,
    unknown
  >;
  const migrated = migrateValue(original, target, steps);
  if (original.version === target) return { file, changed: false };
  const backup = `${file}.backup-${Date.now()}`;
  if (apply) {
    await copyFile(file, backup);
    await atomicJson(file, migrated);
  }
  return { file, changed: true, applied: apply, ...(apply ? { backup } : {}) };
}
