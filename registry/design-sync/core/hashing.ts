import { createHash } from "node:crypto";
import type { DesignNode, DesignNodeReference } from "./types.js";
export function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const result = JSON.stringify(value);
    if (result === undefined) throw new TypeError("Cannot serialize undefined");
    return result;
  }
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .filter((k) => record[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${stableSerialize(record[k])}`)
    .join(",")}}`;
}
export function hash(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableSerialize(value)).digest("hex")}`;
}
export function identity(reference: DesignNodeReference): string {
  return Buffer.from(stableSerialize(reference)).toString("base64url");
}
export function designRevision(node: DesignNode): string {
  function meaningful(n: DesignNode): unknown {
    return {
      id: n.id,
      type: n.type,
      properties: n.properties,
      children: n.children.map(meaningful),
    };
  }
  return hash({ normalizationVersion: 1, node: meaningful(node) });
}
