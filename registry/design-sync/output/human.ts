import type { Report } from "../core/schemas.js";
import type { DesignChange } from "../core/types.js";
export function formatChanges(changes: DesignChange[]) {
  return changes
    .map(
      (change) =>
        `${change.type === "ADDED" ? "+" : change.type === "REMOVED" ? "-" : "~"} ${change.label}${change.property ? "." + change.property : ""} [${change.path}]${change.type === "MODIFIED" ? `\n  ${JSON.stringify(change.before) ?? "(absent)"} → ${JSON.stringify(change.after) ?? "(absent)"}` : ""}`,
    )
    .join("\n");
}
export function formatReport(report: Report) {
  const symbols = {
    IMPLEMENTED: "✓",
    NOT_IMPLEMENTED: "○",
    DESIGN_CHANGED: "△",
    CODE_CHANGED: "↔",
    NEEDS_REVIEW: "!",
    IGNORED: "–",
  };
  return (
    `Design Sync\n\nDesign observation: ${report.observedAt} (${report.freshness.source}, ${report.freshness.ageSeconds}s old)\n\n` +
    report.nodes
      .map(
        (node) =>
          `${symbols[node.status]} ${node.name}\n  ${node.status}${node.route ? "\n  " + node.route : ""}${node.changes.length ? "\n  " + node.changes.length + " design changes" : ""}${node.reasons.length ? "\n  " + node.reasons.join(", ") : ""}`,
      )
      .join("\n\n") +
    "\n\nSummary\n" +
    Object.entries(report.summary)
      .map(([key, count]) => `${key.padEnd(18)} ${count}`)
      .join("\n")
  );
}
