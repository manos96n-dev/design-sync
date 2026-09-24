import path from "node:path";
import { access, realpath, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { DesignSyncError } from "../core/errors.js";
import { hash } from "../core/hashing.js";
export async function exists(file: string) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}
export async function resolveRoot(
  explicit?: string,
  cwd = process.cwd(),
): Promise<string> {
  if (explicit) return realpath(path.resolve(cwd, explicit));
  let current = path.resolve(cwd),
    packageRoot: string | undefined;
  while (true) {
    if (await exists(path.join(current, ".design-sync/config.json")))
      return realpath(current);
    if (!packageRoot && (await exists(path.join(current, "package.json"))))
      packageRoot = current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  try {
    return await realpath(
      execFileSync("git", ["rev-parse", "--show-toplevel"], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim(),
    );
  } catch {
    return realpath(packageRoot ?? cwd);
  }
}
export function normalizePath(file: string): string {
  const value = file.replaceAll("\\", "/");
  const normalized = path.posix.normalize(value);
  if (
    !value ||
    value.includes("\0") ||
    path.posix.isAbsolute(value) ||
    /^[A-Za-z]:/.test(value) ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized === "."
  )
    throw new DesignSyncError(
      "INVALID_PATH",
      `Path must be repository-root-relative: ${file}`,
    );
  return normalized;
}
export async function safeFile(root: string, file: string): Promise<string> {
  const target = path.resolve(root, normalizePath(file));
  const resolved = await realpath(target);
  const relative = path.relative(await realpath(root), resolved);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    throw new DesignSyncError(
      "INVALID_PATH",
      `Path escapes repository through a symlink: ${file}`,
    );
  return resolved;
}
export async function codeRevision(
  root: string,
  files: string[],
): Promise<string> {
  const paths = [...new Set(files.map(normalizePath))].sort();
  if (!paths.length)
    throw new DesignSyncError(
      "INVALID_MAPPING",
      "Implementation requires at least one file.",
    );
  const contents = [];
  for (const file of paths) {
    try {
      // Latin-1 preserves arbitrary bytes while allowing only CRLF normalization.
      const bytes = await readFile(await safeFile(root, file));
      contents.push({
        path: file,
        contents: Buffer.from(
          bytes.toString("latin1").replaceAll("\r\n", "\n"),
          "latin1",
        ).toString("base64"),
      });
    } catch (error) {
      if (error instanceof DesignSyncError) throw error;
      throw new DesignSyncError(
        "MISSING_IMPLEMENTATION_FILE",
        `Cannot read implementation file ${file}. Restore the file or replace the mapping.`,
        { file },
      );
    }
  }
  return hash(contents);
}
