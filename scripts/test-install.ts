import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  readdir,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const execute = promisify(execFile),
  require = createRequire(import.meta.url);
const shadcn = require.resolve("shadcn");
const payload = await readFile("public/r/design-sync.json");
const server = createServer((_req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.end(payload);
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw Error("No server port");
const url = `http://127.0.0.1:${address.port}/r/design-sync.json`;
const temporary = await mkdtemp(path.join(os.tmpdir(), "design-sync-install-"));
async function filesUnder(directory: string): Promise<Record<string, string>> {
  const output: Record<string, string> = {};
  async function walk(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(file);
      else
        output[path.relative(directory, file)] = await readFile(file, "utf8");
    }
  }
  await walk(directory);
  return output;
}
try {
  for (const kind of ["plain-typescript", "existing-shadcn", "monorepo"]) {
    const root = path.join(temporary, kind);
    await mkdir(root, { recursive: true });
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        name: `fixture-${kind}`,
        private: true,
        ...(kind === "existing-shadcn" ? { type: "module" } : {}),
        packageManager: "pnpm@10.32.1",
        scripts: { test: "echo existing" },
        custom: { preserve: true },
      }),
    );
    await writeFile(path.join(root, "tsconfig.json"), "{}\n");
    await writeFile(
      path.join(root, "pnpm-lock.yaml"),
      "lockfileVersion: '9.0'\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\n",
    );
    await writeFile(path.join(root, "sentinel.txt"), "unchanged\n");
    await writeFile(path.join(root, ".env.example"), "EXISTING=value\n");
    if (kind === "existing-shadcn") {
      await writeFile(
        path.join(root, "components.json"),
        JSON.stringify({
          $schema: "https://ui.shadcn.com/schema.json",
          style: "new-york",
          rsc: false,
          tsx: true,
          tailwind: {
            config: "",
            css: "app.css",
            baseColor: "neutral",
            cssVariables: true,
          },
          aliases: {
            components: "@/components",
            utils: "@/lib/utils",
            ui: "@/components/ui",
            lib: "@/lib",
            hooks: "@/hooks",
          },
        }),
      );
      await writeFile(path.join(root, "app.css"), "/* existing styles */\n");
    }
    if (kind === "monorepo") {
      await writeFile(
        path.join(root, "pnpm-workspace.yaml"),
        "packages:\n  - apps/*\n  - packages/*\n",
      );
      await mkdir(path.join(root, "apps/web"), { recursive: true });
      await mkdir(path.join(root, "packages/ui"), { recursive: true });
      await writeFile(
        path.join(root, "apps/web/package.json"),
        '{"name":"web","private":true}',
      );
      await writeFile(
        path.join(root, "packages/ui/package.json"),
        '{"name":"ui","private":true}',
      );
    }
    const sentinelFiles = [
      "tsconfig.json",
      "sentinel.txt",
      ".env.example",
      ...(kind === "existing-shadcn" ? ["components.json", "app.css"] : []),
    ];
    const before = Object.fromEntries(
      await Promise.all(
        sentinelFiles.map(async (file) => [
          file,
          await readFile(path.join(root, file), "utf8"),
        ]),
      ),
    );
    const env = {
      ...process.env,
      npm_config_ignore_workspace_root_check: "true",
      CI: "true",
      FIGMA_ACCESS_TOKEN: "fixture-token",
    };
    console.log(`Installing into ${kind} through ${url}`);
    await execute(
      process.execPath,
      [shadcn, "add", url, "--cwd", root, "--yes"],
      { env, maxBuffer: 5_000_000, timeout: 180_000 },
    );
    const pkg = JSON.parse(
      await readFile(path.join(root, "package.json"), "utf8"),
    );
    for (const dep of ["tsx", "zod", "commander"])
      assert.ok(pkg.devDependencies[dep], `${dep} must be a devDependency`);
    assert.equal(pkg.dependencies?.react, undefined);
    assert.equal(pkg.scripts.test, "echo existing");
    assert.deepEqual(pkg.custom, { preserve: true });
    for (const [file, contents] of Object.entries(before))
      assert.equal(await readFile(path.join(root, file), "utf8"), contents);
    const implementation =
      kind === "monorepo" ? "packages/ui/screen.ts" : "screen.ts";
    await writeFile(
      path.join(root, implementation),
      "export const screen = 1;\n",
    );
    const stateFile = path.join(root, "mock-design.json");
    await writeFile(stateFile, JSON.stringify({ width: 100 }));
    const preload = path.join(root, "mock-figma.mjs");
    await writeFile(
      preload,
      `import {readFile} from 'node:fs/promises';\nglobalThis.fetch=async input=>{const config=JSON.parse(await readFile(${JSON.stringify(stateFile)},'utf8'));if(config.failure)return new Response('',{status:403});const url=new URL(String(input));const frame={id:'1:1',name:'Screen',type:'FRAME',absoluteBoundingBox:{x:0,y:0,width:config.width,height:100}};return Response.json({version:'v1',nodes:Object.fromEntries(url.searchParams.get('ids').split(',').map(id=>[id,{document:id==='0:1'?{id,name:'Page',type:'CANVAS',children:[frame]}:frame}]))});};\n`,
    );
    async function cli(args: string[], expected = 0, cwd = root) {
      let result: { stdout: string; stderr: string; code?: number };
      try {
        result = await execute(
          process.execPath,
          [
            "--import",
            "tsx",
            "--import",
            pathToFileURL(preload).href,
            path.join(root, "tools/design-sync/cli.ts"),
            ...args,
            "--json",
          ],
          { cwd, env, maxBuffer: 5_000_000 },
        );
      } catch (error) {
        result = error as typeof result;
      }
      assert.equal(
        result.code ?? 0,
        expected,
        `${kind}: ${args.join(" ")}\n${result.stdout}\n${result.stderr}`,
      );
      assert.equal(result.stderr, "");
      return JSON.parse(result.stdout);
    }
    await cli([
      "init",
      "--file",
      "fixture",
      "--tracking-roots",
      "0:1",
      "--agent",
      "codex",
    ]);
    assert.equal(
      (await cli(["scan"])).result.nodes[0].status,
      "NOT_IMPLEMENTED",
    );
    await cli(["register", "--node", "1:1", "--files", implementation]);
    assert.equal(
      (await cli(["status"])).result.nodes[0].status,
      "NOT_IMPLEMENTED",
    );
    await cli(["sync", "--node", "1:1"]);
    assert.equal((await cli(["status"])).result.nodes[0].status, "IMPLEMENTED");
    await writeFile(stateFile, JSON.stringify({ width: 120 }));
    assert.equal(
      (await cli(["scan"])).result.nodes[0].status,
      "DESIGN_CHANGED",
    );
    assert.ok(
      (await cli(["diff", "1:1"])).result.changes.some(
        (c: { property?: string }) => c.property === "width",
      ),
    );
    await writeFile(
      path.join(root, implementation),
      "export const screen = 2;\n",
    );
    assert.equal(
      (await cli(["check"], 1)).result.nodes[0].status,
      "NEEDS_REVIEW",
    );
    await writeFile(stateFile, JSON.stringify({ failure: true }));
    await cli(["check"], 2);
    await writeFile(stateFile, JSON.stringify({ width: 120 }));
    await cli(["sync", "--node", "1:1"]);
    await cli(["sync", "--all"], 2);
    if (kind === "monorepo")
      assert.equal(
        (await cli(["status"], 0, path.join(root, "apps/web"))).result.nodes[0]
          .status,
        "IMPLEMENTED",
      );
    const savedState = await filesUnder(path.join(root, ".design-sync"));
    await execute(
      process.execPath,
      [shadcn, "add", url, "--cwd", root, "--yes", "--overwrite"],
      { env, maxBuffer: 5_000_000, timeout: 180_000 },
    );
    assert.deepEqual(
      await filesUnder(path.join(root, ".design-sync")),
      savedState,
      "Upgrade must preserve every project-owned state byte",
    );
    await cli(["init"]);
    await cli(["migrate"]);
    assert.equal((await cli(["status"])).result.nodes[0].status, "IMPLEMENTED");
    for (const [file, contents] of Object.entries(before))
      assert.equal(await readFile(path.join(root, file), "utf8"), contents);
    console.log(
      `PASS ${kind}: install, init, full CLI lifecycle, CI exits, upgrade preservation.`,
    );
  }
} finally {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await rm(temporary, { recursive: true, force: true });
}
