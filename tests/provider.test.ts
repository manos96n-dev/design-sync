import { expect, it, vi } from "vitest";
import { FigmaProvider } from "../registry/design-sync/providers/figma.js";
const reference = (nodeId: string) => ({
  provider: "figma" as const,
  fileKey: "test",
  nodeId,
});
const payload = (ids: string[], version = "v1") => ({
  version,
  nodes: Object.fromEntries(
    ids.map((id) => [id, { document: { id, name: id, type: "FRAME" } }]),
  ),
});
it("batches 121 nodes and pins subsequent calls to the first version", async () => {
  const urls: URL[] = [];
  const transport: typeof fetch = async (input) => {
    const url = new URL(String(input));
    urls.push(url);
    return Response.json(payload(url.searchParams.get("ids")!.split(",")));
  };
  const result = await new FigmaProvider("token", transport).getNodes(
    Array.from({ length: 121 }, (_, i) => reference(`${i}:1`)),
  );
  expect(Object.keys(result.nodes)).toHaveLength(121);
  expect(urls).toHaveLength(3);
  expect(urls[0]!.searchParams.get("version")).toBeNull();
  expect(urls[1]!.searchParams.get("version")).toBe("v1");
  expect(
    urls.every((url) => url.searchParams.get("geometry") === "paths"),
  ).toBe(true);
});
it("distinguishes null nodes from access failure", async () => {
  const provider = new FigmaProvider("token", async () =>
    Response.json({ version: "v1", nodes: { "1:1": null } }),
  );
  expect(await provider.getNode(reference("1:1"))).toBeNull();
  await expect(
    new FigmaProvider(
      "token",
      async () => new Response("", { status: 403 }),
    ).getNode(reference("1:1")),
  ).rejects.toMatchObject({ code: "FIGMA_ACCESS_DENIED" });
});
it("requires a token and rejects missing response keys", async () => {
  await expect(
    new FigmaProvider("", vi.fn()).getNode(reference("1:1")),
  ).rejects.toMatchObject({ code: "MISSING_TOKEN" });
  await expect(
    new FigmaProvider("token", async () =>
      Response.json({ nodes: {} }),
    ).getNode(reference("1:1")),
  ).rejects.toMatchObject({ code: "INVALID_PROVIDER_DATA" });
});
it("honors short Retry-After and refuses long sleeps", async () => {
  const pause = vi.fn(async () => {});
  let count = 0;
  const provider = new FigmaProvider(
    "token",
    async () =>
      ++count === 1
        ? new Response("", { status: 429, headers: { "Retry-After": "2" } })
        : Response.json(payload(["1:1"])),
    pause,
  );
  await provider.getNode(reference("1:1"));
  expect(pause).toHaveBeenCalledWith(2000);
  await expect(
    new FigmaProvider(
      "token",
      async () =>
        new Response("", { status: 429, headers: { "Retry-After": "3600" } }),
      pause,
    ).getNode(reference("1:1")),
  ).rejects.toMatchObject({ code: "FIGMA_RATE_LIMIT" });
});
it("retries transient network errors with a finite budget", async () => {
  const transport = vi.fn(async () => {
    throw Error("offline");
  });
  await expect(
    new FigmaProvider("token", transport, async () => {}).getNode(
      reference("1:1"),
    ),
  ).rejects.toMatchObject({ code: "NETWORK_FAILURE" });
  expect(transport).toHaveBeenCalledTimes(3);
});
it("fails closed on inconsistent version responses", async () => {
  await expect(
    new FigmaProvider("token", async () =>
      Response.json(payload(["1:1"], "v2")),
    ).getNodes([reference("1:1")], "v1"),
  ).rejects.toMatchObject({ code: "INVALID_PROVIDER_DATA" });
});
it("reports malformed node properties as provider errors", async () => {
  await expect(
    new FigmaProvider("token", async () =>
      Response.json({
        version: "v1",
        nodes: {
          "1:1": {
            document: { id: "1:1", name: "Bad", type: "FRAME", opacity: "bad" },
          },
        },
      }),
    ).getNode(reference("1:1")),
  ).rejects.toMatchObject({ code: "INVALID_PROVIDER_DATA" });
});
