import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { FigmaProvider } from "../registry/design-sync/providers/figma.js";
import {
  init,
  register,
  sync,
} from "../registry/design-sync/commands/mutate.js";
import { scan, status } from "../registry/design-sync/commands/observe.js";
const file = process.env.DESIGN_SYNC_TEST_FILE,
  node = process.env.DESIGN_SYNC_TEST_NODE;
if (!process.env.FIGMA_ACCESS_TOKEN || !file || !node)
  throw Error(
    "Real-Figma acceptance requires FIGMA_ACCESS_TOKEN, DESIGN_SYNC_TEST_FILE, and DESIGN_SYNC_TEST_NODE in the environment. Do not paste tokens into chat.",
  );
const root = await mkdtemp(path.join(os.tmpdir(), "design-sync-live-"));
try {
  await writeFile(
    path.join(root, "package.json"),
    '{"name":"live-test","private":true}',
  );
  await writeFile(
    path.join(root, "fixture.ts"),
    "// Acceptance-test mapping; not an implemented UI.\n",
  );
  await init(root, { file }, path.join(root, "tools/design-sync/cli.ts"));
  await register(root, { node, files: "fixture.ts" });
  const provider = new FigmaProvider();
  assert.equal(
    (await scan(root, provider)).nodes[0]?.status,
    "MAPPED_AWAITING_BASELINE",
  );
  // Disposable acceptance baseline tests storage and transport, not visual correctness.
  await sync(root, node, provider);
  assert.equal((await status(root)).nodes[0]?.status, "IMPLEMENTED");
  console.log(
    "PASS live Figma read, normalization, baseline, and cached status. No Figma writes performed.",
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
