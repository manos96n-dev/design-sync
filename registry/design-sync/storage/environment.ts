import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { DesignSyncError } from "../core/errors.js";

/** Read only the provider credential; unrelated application env stays untouched. */
export async function loadFigmaEnvironment(
  root: string,
  environment: NodeJS.ProcessEnv = process.env,
  toolkitDirectory = fileURLToPath(new URL("../", import.meta.url)),
): Promise<void> {
  if (environment.FIGMA_ACCESS_TOKEN !== undefined) return;
  for (const file of new Set([
    path.join(root, ".env"),
    path.join(toolkitDirectory, ".env"),
  ])) {
    let contents: string;
    try {
      contents = await readFile(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw new DesignSyncError(
        "ENV_FILE_UNREADABLE",
        `Cannot read ${file}. Check file permissions.`,
      );
    }
    let token: string | undefined;
    try {
      token = parseEnv(contents).FIGMA_ACCESS_TOKEN;
    } catch {
      throw new DesignSyncError(
        "INVALID_ENV_FILE",
        `Cannot parse ${file}. Check its dotenv syntax.`,
      );
    }
    if (token !== undefined) {
      environment.FIGMA_ACCESS_TOKEN = token;
      return;
    }
  }
}
