import type { DesignStatus } from "./types.js";
export type ClassificationInput = {
  ignored?: boolean;
  ambiguous?: boolean;
  exists: boolean;
  hasMapping: boolean;
  baselineDesignRevision?: string;
  baselineCodeRevision?: string;
  currentDesignRevision?: string;
  currentCodeRevision?: string;
};
export function classifyStatus(input: ClassificationInput): DesignStatus {
  if (input.ignored) return "IGNORED";
  if (
    input.ambiguous ||
    !input.exists ||
    !input.currentDesignRevision ||
    (input.hasMapping && !input.currentCodeRevision)
  )
    return "NEEDS_REVIEW";
  const partial =
    Boolean(input.baselineDesignRevision) !==
    Boolean(input.baselineCodeRevision);
  if (
    partial ||
    (!input.hasMapping &&
      (input.baselineDesignRevision || input.baselineCodeRevision))
  )
    return "NEEDS_REVIEW";
  if (!input.hasMapping) return "NOT_IMPLEMENTED";
  if (!input.baselineDesignRevision) return "MAPPED_AWAITING_BASELINE";
  const design = input.baselineDesignRevision !== input.currentDesignRevision;
  const code = input.baselineCodeRevision !== input.currentCodeRevision;
  return design && code
    ? "NEEDS_REVIEW"
    : design
      ? "DESIGN_CHANGED"
      : code
        ? "CODE_CHANGED"
        : "IMPLEMENTED";
}
