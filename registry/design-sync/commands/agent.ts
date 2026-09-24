import type { Report } from "../core/schemas.js";

export function buildAgentPlan(report: Report) {
  const mappingCandidates = report.nodes
    .filter(
      (node) =>
        node.status !== "IGNORED" && node.reasons.includes("MAPPING_MISSING"),
    )
    .map((node) => ({
      reference: node.reference,
      nodeId: node.nodeId,
      name: node.name,
      status: node.status,
      ...(node.devStatus !== undefined ? { devStatus: node.devStatus } : {}),
      ...(node.route ? { route: node.route } : {}),
      reasons: node.reasons,
    }));
  const count = mappingCandidates.length;
  const readiness = {
    readyForDev: mappingCandidates.filter(
      (node) => node.devStatus?.type === "READY_FOR_DEV",
    ).length,
    completed: mappingCandidates.filter(
      (node) => node.devStatus?.type === "COMPLETED",
    ).length,
    none: mappingCandidates.filter((node) => node.devStatus === null).length,
    unknown: mappingCandidates.filter((node) => node.devStatus === undefined)
      .length,
  };
  const noun = count === 1 ? "design" : "designs";
  const approvalQuestion =
    count > 0
      ? `Start a design-mapping agent for ${count} ${noun}, including ${readiness.readyForDev} marked Ready for dev? Starting an agent uses your model token allowance. The agent will inspect the repository, prioritize Ready for dev designs, propose and register defensible mappings, leave ambiguous designs unmapped, and will not accept synchronization baselines.`
      : "No unmapped product designs were found, so a mapping agent is not recommended.";
  const promptAfterApproval =
    count > 0
      ? `The user explicitly approved starting a design-mapping agent for ${count} ${noun}. Follow tools/design-sync/agents/workflow.md. Read the repository instructions and run the JSON status workflow. Prioritize nodes whose devStatus.type is READY_FOR_DEV, but report every candidate's readiness. Inspect each MAPPING_MISSING node and the codebase, register only evidence-backed mappings, document unresolved designs, and verify the final status. After implementation and verification, list the exact verified Figma node IDs and ask the separate figmaCompletionApproval.question before changing any node to COMPLETED in Figma. Do not treat mapping approval as Figma-write approval. Do not run design:sync or accept any baseline unless the user separately requests it after reviewing the implementation.`
      : undefined;
  const copyablePrompt =
    count > 0
      ? `Use the repository's Design Sync workflow to prepare agent-assisted mapping. Run pnpm --silent design:agent-plan --json and inspect its ${count} mapping candidates, including ${readiness.readyForDev} marked Ready for dev. Show me the candidate scope and the exact approval.question, clearly stating that starting the mapping agent uses my model token allowance. Do not start, spawn, delegate to, or perform the mapping agent's work until I explicitly approve. After approval, use promptAfterApproval exactly as the mapping agent's task. When implementation and verification finish, list the exact verified node IDs and ask figmaCompletionApproval.question before marking anything COMPLETED in Figma. Mapping approval does not authorize that Figma write. Do not accept synchronization baselines unless I separately request that after review.`
      : undefined;

  return {
    version: 1 as const,
    kind: "design-mapping" as const,
    agentStarted: false as const,
    recommendation:
      count > 0 ? ("START_AGENT" as const) : ("NO_ACTION" as const),
    approval: {
      requiredBeforeAgentStart: count > 0,
      granted: false as const,
      tokenUsageNotice: count > 0,
      question: approvalQuestion,
    },
    figmaCompletionApproval: {
      requiredBeforeWrite: true as const,
      granted: false as const,
      defaultAction: "LEAVE_FIGMA_UNCHANGED" as const,
      cliCanWrite: false as const,
      question:
        "The listed designs have been implemented and verified. Do you want me to mark these exact Figma nodes as Completed? This changes shared Figma state. I will leave them unchanged unless you explicitly approve.",
      instructions:
        "Ask only after implementation and verification. Include each exact fileKey/nodeId and name. If approved, use an available authenticated Figma write tool, read the nodes back, then run a fresh Design Sync scan. If no write tool or permission is available, report that and leave Figma unchanged.",
    },
    mappingCandidateCount: count,
    readiness,
    mappingCandidates,
    ...(copyablePrompt ? { copyablePrompt } : {}),
    ...(promptAfterApproval ? { promptAfterApproval } : {}),
    observation: {
      observedAt: report.observedAt,
      freshness: report.freshness,
    },
  };
}

export type AgentPlan = ReturnType<typeof buildAgentPlan>;
