import type { Report } from "../core/schemas.js";
import type { DesignChange } from "../core/types.js";
import { buildAgentPlan, type AgentPlan } from "../commands/agent.js";
export function formatChanges(changes: DesignChange[]) {
  return changes
    .map(
      (change) =>
        `${change.type === "ADDED" ? "+" : change.type === "REMOVED" ? "-" : "~"} ${change.label}${change.property ? "." + change.property : ""} [${change.path}]${change.type === "MODIFIED" ? `\n  ${JSON.stringify(change.before) ?? "(absent)"} → ${JSON.stringify(change.after) ?? "(absent)"}` : ""}`,
    )
    .join("\n");
}
type ReportNode = Report["nodes"][number];

const symbols: Record<ReportNode["status"], string> = {
  IMPLEMENTED: "✓",
  NOT_IMPLEMENTED: "○",
  MAPPED_AWAITING_BASELINE: "◌",
  DESIGN_CHANGED: "△",
  CODE_CHANGED: "↔",
  NEEDS_REVIEW: "!",
  IGNORED: "–",
};

function ageLabel(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function readinessLabel(node: ReportNode) {
  return (
    node.devStatus?.type ?? (node.devStatus === null ? "UNMARKED" : "UNKNOWN")
  );
}

function compactNode(node: ReportNode) {
  return `  ${symbols[node.status]} ${node.name} [${node.nodeId}] · ${readinessLabel(node)}${node.route ? ` · ${node.route}` : ""}`;
}

function detailedNode(node: ReportNode) {
  const state =
    node.status === "MAPPED_AWAITING_BASELINE"
      ? "MAPPED — BASELINE NOT ACCEPTED"
      : node.reasons.includes("MAPPING_MISSING")
        ? "UNMAPPED"
        : node.status;
  return [
    `${symbols[node.status]} ${node.name} [${node.nodeId}]`,
    `  ${state} · ${readinessLabel(node)}`,
    ...(node.devStatus?.description
      ? [`  Figma note: ${node.devStatus.description}`]
      : []),
    ...(node.route ? [`  Route: ${node.route}`] : []),
    ...(node.implementationFiles.length
      ? [`  Files: ${node.implementationFiles.join(", ")}`]
      : []),
    ...(node.changes.length
      ? [`  Design changes: ${node.changes.length}`]
      : []),
    ...(node.reasons.length ? [`  Reasons: ${node.reasons.join(", ")}`] : []),
  ].join("\n");
}

function compactGroup(title: string, nodes: ReportNode[], limit: number) {
  if (!nodes.length) return "";
  const shown = nodes.slice(0, limit);
  return [
    `${title} (${nodes.length})`,
    ...shown.map(compactNode),
    ...(nodes.length > shown.length
      ? [
          `  … ${nodes.length - shown.length} more; use --all to show every node`,
        ]
      : []),
  ].join("\n");
}

function detailedGroup(title: string, nodes: ReportNode[]) {
  if (!nodes.length) return "";
  return `${title} (${nodes.length})\n\n${nodes.map(detailedNode).join("\n\n")}`;
}

export function formatReport(
  report: Report,
  options: { showAll?: boolean } = {},
) {
  const active = report.nodes.filter((node) => node.status !== "IGNORED");
  const needsReview = active.filter((node) => node.status === "NEEDS_REVIEW");
  const designChanged = active.filter(
    (node) => node.status === "DESIGN_CHANGED",
  );
  const codeChanged = active.filter((node) => node.status === "CODE_CHANGED");
  const unmapped = active.filter((node) =>
    node.reasons.includes("MAPPING_MISSING"),
  );
  const readyUnmapped = unmapped.filter(
    (node) => node.devStatus?.type === "READY_FOR_DEV",
  );
  const otherUnmapped = unmapped.filter(
    (node) => node.devStatus?.type !== "READY_FOR_DEV",
  );
  const awaitingBaseline = active.filter(
    (node) => node.status === "MAPPED_AWAITING_BASELINE",
  );
  const acceptedAndMatching = active.filter(
    (node) => node.status === "IMPLEMENTED",
  );
  const ignored = report.nodes.filter((node) => node.status === "IGNORED");
  const coverage = report.summary.coverage;
  const mappedPercent = coverage.active
    ? Math.round((coverage.mappedToCode / coverage.active) * 100)
    : 100;
  const fileKey = report.nodes[0]?.reference.fileKey ?? "unknown";
  const source = report.freshness.source === "cache" ? "cached" : "live";
  const overview = [
    "Design Sync status",
    `Figma ${fileKey} · ${source} observation · ${ageLabel(report.freshness.ageSeconds)} old`,
    `Observed ${report.observedAt}`,
    "",
    "Implementation coverage",
    `  ${coverage.mappedToCode}/${coverage.active} active designs mapped to code (${mappedPercent}%)`,
    `  ${coverage.unmapped} unmapped · ${coverage.mappedAwaitingBaseline} awaiting baseline · ${coverage.acceptedBaselines} accepted baselines`,
    `  ${ignored.length} ignored canvas artifacts`,
    "",
    "Figma readiness",
    `  ${report.summary.devStatus.readyForDev} Ready for dev · ${report.summary.devStatus.completed} Completed · ${report.summary.devStatus.none} unmarked · ${report.summary.devStatus.unknown} unknown`,
    "",
    "Revision health",
    `  ${needsReview.length} need review · ${designChanged.length} design changed · ${codeChanged.length} code changed · ${acceptedAndMatching.length} accepted and matching`,
  ].join("\n");

  const groups = options.showAll
    ? [
        detailedGroup("Needs review", needsReview),
        detailedGroup("Design changed", designChanged),
        detailedGroup("Code changed", codeChanged),
        detailedGroup("Unmapped · Ready for dev", readyUnmapped),
        detailedGroup("Unmapped · Not ready or unmarked", otherUnmapped),
        detailedGroup("Mapped · Baseline not accepted", awaitingBaseline),
        detailedGroup("Accepted and matching", acceptedAndMatching),
        detailedGroup("Ignored", ignored),
      ]
    : [
        compactGroup("Needs review", needsReview, 10),
        compactGroup("Design changed", designChanged, 10),
        compactGroup("Code changed", codeChanged, 10),
        compactGroup("Unmapped · Ready for dev", readyUnmapped, 12),
        compactGroup("Unmapped · Not ready or unmarked", otherUnmapped, 6),
        compactGroup("Mapped · Baseline not accepted", awaitingBaseline, 6),
      ];
  const actionable = groups.filter(Boolean).join("\n\n");
  const details = actionable
    ? `\n\n${options.showAll ? "All tracked nodes" : "Needs attention"}\n\n${actionable}`
    : "\n\nNeeds attention\n\n  None";

  return overview + details + formatAgentRecommendation(report);
}

function formatAgentRecommendation(report: Report) {
  const plan = buildAgentPlan(report);
  const count = plan.mappingCandidateCount;
  if (!count) return "";
  return `\n\nAI-assisted mapping\n${count} product design${count === 1 ? " needs" : "s need"} code mappings. Run design:agent-plan to prepare a read-only handoff. It will not start an agent. Starting an agent uses model tokens and requires the user's explicit approval.\n\nCopyable prompt for your coding agent\n--- BEGIN PROMPT ---\n${plan.copyablePrompt}\n--- END PROMPT ---`;
}

export function formatAgentPlan(plan: AgentPlan) {
  if (plan.recommendation === "NO_ACTION")
    return "No unmapped product designs were found. No mapping agent is needed.";
  return `AI-assisted mapping\n\n${plan.mappingCandidateCount} product design${plan.mappingCandidateCount === 1 ? " needs" : "s need"} code mappings (${plan.readiness.readyForDev} Ready for dev, ${plan.readiness.completed} Completed, ${plan.readiness.none} unmarked, ${plan.readiness.unknown} unknown). No agent has been started.\n\nCopyable prompt for your coding agent\n--- BEGIN PROMPT ---\n${plan.copyablePrompt}\n--- END PROMPT ---\n\nApproval question the agent must ask before launch:\n${plan.approval.question}\n\nPrompt to use only after approval:\n--- BEGIN APPROVED TASK ---\n${plan.promptAfterApproval}\n--- END APPROVED TASK ---\n\nSeparate Figma completion approval required after verification:\n${plan.figmaCompletionApproval.question}`;
}
