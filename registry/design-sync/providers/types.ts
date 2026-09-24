import type { DesignNode, DesignNodeReference } from "../core/types.js";
export interface DesignProvider {
  getNodes(
    references: DesignNodeReference[],
    version?: string,
  ): Promise<{ nodes: Record<string, DesignNode | null>; version?: string }>;
  getNode(reference: DesignNodeReference): Promise<DesignNode | null>;
  getReferenceImage?(reference: DesignNodeReference): Promise<Uint8Array>;
}
