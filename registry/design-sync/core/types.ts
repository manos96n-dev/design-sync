export const TOOL_VERSION = "0.1.0";
export const SCHEMA_VERSION = 1;
export const NORMALIZATION_VERSION = 1;
export const STATUSES = [
  "NOT_IMPLEMENTED",
  "IMPLEMENTED",
  "DESIGN_CHANGED",
  "CODE_CHANGED",
  "NEEDS_REVIEW",
  "IGNORED",
] as const;
export type DesignStatus = (typeof STATUSES)[number];
export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };
export type DesignNodeReference = {
  provider: "figma";
  fileKey: string;
  nodeId: string;
};
export type DesignNode = {
  id: string;
  name: string;
  type: string;
  properties: Record<string, Json>;
  children: DesignNode[];
  issues: string[];
};
export type DesignChange = {
  type: "ADDED" | "REMOVED" | "MODIFIED";
  path: string;
  label: string;
  property?: string;
  before?: Json;
  after?: Json;
};
export type ImplementationTarget = {
  files: string[];
  route?: string;
  story?: string;
  test?: string;
};
export type VisualVerification = {
  status: "PASSED" | "FAILED" | "UNAVAILABLE";
  differenceRatio?: number;
  verifiedAt?: string;
};
export interface VisualVerifier {
  verify(input: {
    reference: DesignNodeReference;
    implementation: ImplementationTarget;
    referenceImage: Uint8Array;
  }): Promise<VisualVerification>;
}
