import type { DesignNode } from "./types.js";
/** A tracked unit's position on its containing canvas is display metadata. */
export function asUnit(node: DesignNode): DesignNode {
  const unit = structuredClone(node);
  delete unit.properties.x;
  delete unit.properties.y;
  const transform = unit.properties.transform;
  if (
    Array.isArray(transform) &&
    Array.isArray(transform[0]) &&
    Array.isArray(transform[1])
  ) {
    transform[0][2] = 0;
    transform[1][2] = 0;
  }
  return unit;
}
