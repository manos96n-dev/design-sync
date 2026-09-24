import { Command, CommanderError } from "commander";
import { TOOL_VERSION } from "./core/types.js";
import { DesignSyncError } from "./core/errors.js";
import { resolveRoot } from "./storage/paths.js";
import { loadFigmaEnvironment } from "./storage/environment.js";
import { loadState } from "./storage/state.js";
import { FigmaProvider } from "./providers/figma.js";
import { scan, status } from "./commands/observe.js";
import { buildAgentPlan } from "./commands/agent.js";
import {
  init,
  register,
  sync,
  migrate,
  installedCli,
} from "./commands/mutate.js";
import {
  formatReport,
  formatChanges,
  formatAgentPlan,
} from "./output/human.js";
import { successEnvelope, errorEnvelope } from "./output/json.js";
const program = new Command();
const jsonMode = process.argv.includes("--json");
let commandName = "unknown";
program
  .name("design-sync")
  .description("Track explicit design/code synchronization baselines.")
  .option("--json", "Print one JSON document")
  .option("--root <path>", "Repository root")
  .exitOverride()
  .configureOutput({
    writeOut: (text) => {
      if (!jsonMode) process.stdout.write(text);
    },
    writeErr: (text) => {
      if (!jsonMode) process.stderr.write(text);
    },
  });
async function run(
  name: string,
  action: (
    root: string,
  ) => Promise<{ result: unknown; human?: string; exitCode?: number }>,
) {
  commandName = name;
  const root = await resolveRoot(program.opts<{ root?: string }>().root);
  await loadFigmaEnvironment(root);
  const { result, human, exitCode } = await action(root);
  process.stdout.write(
    jsonMode
      ? JSON.stringify(successEnvelope(name, result)) + "\n"
      : (human ?? JSON.stringify(result, null, 2)) + "\n",
  );
  process.exitCode = exitCode ?? 0;
}
program
  .command("init")
  .option("--file <key>", "Figma file key for new config")
  .option("--tracking-roots <ids>", "Comma-separated discovery roots")
  .option(
    "--agent <agent>",
    "Install optional codex, claude, or cursor workflow",
  )
  .action((options) =>
    run("init", async (root) => ({
      result: await init(root, options, installedCli),
    })),
  );
program
  .command("register")
  .requiredOption("--node <id>")
  .requiredOption(
    "--files <paths>",
    "Comma-separated repository-relative files",
  )
  .option("--route <route>")
  .option("--story <story>")
  .option("--test <test>")
  .option("--name <name>")
  .option("--replace")
  .action((options) =>
    run("register", async (root) => ({
      result: await register(root, options),
    })),
  );
program
  .command("scan")
  .option("--all", "Show every tracked node in human output")
  .action((options) =>
    run("scan", async (root) => {
      const result = await scan(root, new FigmaProvider());
      return {
        result,
        human: formatReport(result, { showAll: Boolean(options.all) }),
      };
    }),
  );
program
  .command("status")
  .option("--refresh")
  .option("--all", "Show every tracked node in human output")
  .action((options) =>
    run("status", async (root) => {
      const result = options.refresh
        ? await scan(root, new FigmaProvider())
        : await status(root);
      return {
        result,
        human: formatReport(result, { showAll: Boolean(options.all) }),
      };
    }),
  );
program
  .command("agent-plan")
  .description(
    "Prepare an approval-gated agent mapping handoff without starting an agent",
  )
  .option("--refresh")
  .action((options) =>
    run("agent-plan", async (root) => {
      const report = options.refresh
        ? await scan(root, new FigmaProvider())
        : await status(root);
      const result = buildAgentPlan(report);
      return { result, human: formatAgentPlan(result) };
    }),
  );
program
  .command("diff")
  .argument("[node-id]")
  .option("--node <id>")
  .option("--refresh")
  .action((argument, options) =>
    run("diff", async (root) => {
      if (argument && options.node && argument !== options.node)
        throw new DesignSyncError(
          "INVALID_ARGUMENT",
          "Positional node and --node must agree.",
        );
      const id = options.node ?? argument;
      if (!id)
        throw new DesignSyncError(
          "NODE_REQUIRED",
          "Specify a node ID or --node <id>.",
        );
      const report = options.refresh
        ? await scan(root, new FigmaProvider())
        : await status(root);
      const node = report.nodes.find((n) => n.nodeId === id);
      if (!node)
        throw new DesignSyncError(
          "NODE_NOT_TRACKED",
          `Node ${id} is not in the observation. Include or register it and scan.`,
        );
      if (!node.baselineDesignRevision)
        throw new DesignSyncError(
          "BASELINE_MISSING",
          "No synchronized baseline exists for this node. Register, implement, verify, then explicitly sync it.",
        );
      if (
        node.reasons.some((reason) =>
          [
            "DESIGN_MISSING",
            "OBSERVATION_MISSING",
            "CORRUPT_OR_INCOMPATIBLE_SNAPSHOT",
          ].includes(reason),
        )
      )
        throw new DesignSyncError(
          "DIFF_UNAVAILABLE",
          "Cannot compute a reliable diff.",
          { reasons: node.reasons },
        );
      return {
        result: {
          ...node,
          observedAt: report.observedAt,
          freshness: report.freshness,
        },
        human: `${node.name}\n\n${node.changes.length} changes\n\n${formatChanges(node.changes)}`,
      };
    }),
  );
program
  .command("sync")
  .requiredOption("--node <id>")
  .action((options) =>
    run("sync", async (root) => {
      const result = await sync(root, options.node, new FigmaProvider());
      return {
        result,
        human: `✓ ${result.name} synchronized\n\nDesign ${result.designRevision}\nCode   ${result.codeRevision}`,
      };
    }),
  );
program
  .command("check")
  .option("--all", "Show every tracked node in human output")
  .action((options) =>
    run("check", async (root) => {
      const result = await scan(root, new FigmaProvider());
      const { config } = await loadState(root);
      return {
        result,
        human: formatReport(result, { showAll: Boolean(options.all) }),
        exitCode: result.nodes.some((node) =>
          config.ci.failOn.includes(node.status),
        )
          ? 1
          : 0,
      };
    }),
  );
program
  .command("migrate")
  .option("--apply", "Apply supported migrations; default previews")
  .action((options) =>
    run("migrate", async (root) => ({
      result: await migrate(root, Boolean(options.apply)),
    })),
  );
program.command("version").action(() =>
  run("version", async () => ({
    result: {
      toolVersion: TOOL_VERSION,
      configVersion: 1,
      manifestVersion: 1,
      snapshotVersion: 1,
      normalizationVersion: 1,
      outputVersion: 1,
    },
    human: `Design Sync ${TOOL_VERSION}\nManifest schema 1`,
  })),
);
async function main() {
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    if (error instanceof CommanderError && error.exitCode === 0) {
      if (jsonMode)
        process.stdout.write(
          JSON.stringify(
            successEnvelope("help", { help: program.helpInformation() }),
          ) + "\n",
        );
      return;
    }
    const normalized =
      error instanceof CommanderError
        ? new DesignSyncError("INVALID_ARGUMENT", error.message)
        : error;
    const output = errorEnvelope(commandName, normalized);
    process.stdout.write(jsonMode ? JSON.stringify(output) + "\n" : "");
    if (!jsonMode)
      process.stderr.write(`${output.error.code}: ${output.error.message}\n`);
    process.exitCode = 2;
  }
}
void main();
