import { describe, expect, it } from "vitest";
import { classifyStatus } from "../registry/design-sync/core/classifier.js";
import { normalizeFigma } from "../registry/design-sync/providers/normalization.js";
import {
  designRevision,
  hash,
  identity,
} from "../registry/design-sync/core/hashing.js";
import { diffDesign } from "../registry/design-sync/core/diff.js";
import {
  configSchema,
  manifestSchema,
  statusSchema,
} from "../registry/design-sync/core/schemas.js";
import { normalizePath } from "../registry/design-sync/storage/paths.js";
import { migrateValue } from "../registry/design-sync/storage/migrations.js";
const base = () => ({
  id: "1:1",
  name: "Screen",
  type: "FRAME",
  absoluteBoundingBox: { x: 10, y: 20, width: 100, height: 200 },
  children: [
    {
      id: "2:1",
      name: "Title",
      type: "TEXT",
      characters: "Hello",
      style: { fontSize: 16 },
      absoluteBoundingBox: { x: 20, y: 30, width: 50, height: 20 },
    },
    { id: "3:1", name: "Title", type: "RECTANGLE", cornerRadius: 8 },
  ],
});
describe("classification", () => {
  const input = {
    exists: true,
    hasMapping: true,
    baselineDesignRevision: "a",
    baselineCodeRevision: "b",
    currentDesignRevision: "a",
    currentCodeRevision: "b",
  };
  it.each([
    [{}, "IMPLEMENTED"],
    [{ currentDesignRevision: "c" }, "DESIGN_CHANGED"],
    [{ currentCodeRevision: "c" }, "CODE_CHANGED"],
    [{ currentDesignRevision: "c", currentCodeRevision: "d" }, "NEEDS_REVIEW"],
    [{ ignored: true, exists: false }, "IGNORED"],
    [{ ambiguous: true }, "NEEDS_REVIEW"],
    [{ exists: false }, "NEEDS_REVIEW"],
    [{ currentCodeRevision: undefined }, "NEEDS_REVIEW"],
    [{ currentDesignRevision: undefined }, "NEEDS_REVIEW"],
    [{ baselineCodeRevision: undefined }, "NEEDS_REVIEW"],
    [{ baselineDesignRevision: undefined }, "NEEDS_REVIEW"],
    [
      { baselineDesignRevision: undefined, baselineCodeRevision: undefined },
      "NOT_IMPLEMENTED",
    ],
    [{ hasMapping: false }, "NEEDS_REVIEW"],
    [
      {
        hasMapping: false,
        baselineDesignRevision: undefined,
        baselineCodeRevision: undefined,
        currentCodeRevision: undefined,
      },
      "NOT_IMPLEMENTED",
    ],
  ])("classifies %o as %s", (changes, expected) =>
    expect(classifyStatus({ ...input, ...changes })).toBe(expected),
  );
  it("covers every baseline/current change combination", () => {
    for (const design of [true, false])
      for (const code of [true, false])
        for (const ignored of [true, false])
          for (const ambiguous of [true, false]) {
            expect(
              classifyStatus({
                ...input,
                ignored,
                ambiguous,
                currentDesignRevision: design ? "changed" : "a",
                currentCodeRevision: code ? "changed" : "b",
              }),
            ).toBe(
              ignored
                ? "IGNORED"
                : ambiguous || (design && code)
                  ? "NEEDS_REVIEW"
                  : design
                    ? "DESIGN_CHANGED"
                    : code
                      ? "CODE_CHANGED"
                      : "IMPLEMENTED",
            );
          }
  });
});
describe("normalization and diff", () => {
  it("is deterministic across object ordering and irrelevant metadata", () => {
    const raw = base(),
      original = designRevision(normalizeFigma(raw));
    expect(
      designRevision(
        normalizeFigma({
          ...raw,
          name: "Renamed",
          lastModified: "later",
          pluginData: { transient: 10 },
        }),
      ),
    ).toBe(original);
    expect(hash({ b: 2, a: 1 })).toBe(hash({ a: 1, b: 2 }));
  });
  it("ignores translation of a complete frame on canvas", () => {
    const raw = base(),
      moved = base();
    moved.absoluteBoundingBox.x += 100;
    moved.absoluteBoundingBox.y += 100;
    moved.children[0]!.absoluteBoundingBox!.x += 100;
    moved.children[0]!.absoluteBoundingBox!.y += 100;
    expect(designRevision(normalizeFigma(raw))).toBe(
      designRevision(normalizeFigma(moved)),
    );
  });
  it.each([
    "layout",
    "typography",
    "text",
    "add",
    "remove",
    "reorder",
    "vector",
  ] as const)("detects %s", (kind) => {
    const original = base(),
      changed = base();
    if (kind === "layout") changed.absoluteBoundingBox.width++;
    if (kind === "typography") changed.children[0]!.style!.fontSize++;
    if (kind === "text") changed.children[0]!.characters = "World";
    if (kind === "add")
      changed.children.push({
        id: "4:1",
        name: "New",
        type: "RECTANGLE",
        cornerRadius: 0,
      });
    if (kind === "remove") changed.children.pop();
    if (kind === "reorder") changed.children.reverse();
    if (kind === "vector")
      Object.assign(changed.children[1]!, {
        type: "VECTOR",
        fillGeometry: [{ path: "M 1 1 L 2 2", windingRule: "NONZERO" }],
      });
    expect(designRevision(normalizeFigma(changed))).not.toBe(
      designRevision(normalizeFigma(original)),
    );
    expect(
      diffDesign(normalizeFigma(original), normalizeFigma(changed)).length,
    ).toBeGreaterThan(0);
  });
  it("uses IDs rather than duplicate names and detects reparenting", () => {
    const before = normalizeFigma(base()),
      after = structuredClone(before);
    after.children[1]!.children.push(after.children.shift()!);
    const changes = diffDesign(before, after);
    expect(
      changes.some((c) => c.property === "parent" && c.path.endsWith("/2:1")),
    ).toBe(true);
    expect(
      changes.some((c) => c.type === "ADDED" || c.type === "REMOVED"),
    ).toBe(false);
  });
  it("flags unsupported nodes and missing vector geometry", () => {
    expect(
      normalizeFigma({ id: "a", name: "x", type: "SHADER_UNKNOWN" }).issues,
    ).toContain("UNSUPPORTED_NODE:SHADER_UNKNOWN");
    expect(
      normalizeFigma({ id: "a", name: "x", type: "VECTOR" }).issues,
    ).toContain("VECTOR_GEOMETRY_MISSING");
  });
});
describe("schemas and paths", () => {
  it("preserves project extension data", () => {
    expect(
      configSchema.parse({
        version: 1,
        provider: "figma",
        figma: { fileKey: "test", extra: true },
        tracking: {},
        custom: { hello: "world" },
      }).custom,
    ).toEqual({ hello: "world" });
    expect(
      manifestSchema.parse({ version: 1, nodes: {}, custom: true }).custom,
    ).toBe(true);
  });
  it("rejects unsupported schema versions and unknown statuses", () => {
    expect(() => manifestSchema.parse({ version: 2, nodes: {} })).toThrow();
    expect(() => statusSchema.parse("GOOD")).toThrow();
  });
  it.each(["../secret", "/absolute", "C:\\file", "a/../../secret", ""])(
    "rejects %s",
    (p) => expect(() => normalizePath(p)).toThrow(),
  );
  it("normalizes Windows and relative paths", () =>
    expect(normalizePath("apps\\web/./page.tsx")).toBe("apps/web/page.tsx"));
  it("identity includes file key", () =>
    expect(
      identity({ provider: "figma", fileKey: "a", nodeId: "1:2" }),
    ).not.toBe(identity({ provider: "figma", fileKey: "b", nodeId: "1:2" })));
  it("migrations preserve extension data and reject unsupported versions", () => {
    expect(
      migrateValue({ version: 1, custom: { a: true } }, 2, [
        { from: 1, to: 2, apply: (value) => ({ ...value, newField: true }) },
      ]),
    ).toEqual({ version: 2, custom: { a: true }, newField: true });
    expect(() => migrateValue({ version: 0 }, 1, [])).toThrow();
    expect(() => migrateValue({ version: 2 }, 1, [])).toThrow();
  });
});
it("rejects malformed implementation-relevant provider properties", () => {
  expect(() =>
    normalizeFigma({ id: "a", name: "x", type: "FRAME", opacity: "opaque" }),
  ).toThrow();
  expect(() =>
    normalizeFigma({
      id: "a",
      name: "x",
      type: "FRAME",
      children: "not-an-array",
    }),
  ).toThrow();
});
it("distinguishes absent properties from explicit null in diffs", () => {
  const before = normalizeFigma({ id: "a", name: "Frame", type: "FRAME" }),
    after = structuredClone(before);
  after.properties.minWidth = null;
  expect(designRevision(before)).not.toBe(designRevision(after));
  expect(diffDesign(before, after)).toContainEqual({
    type: "MODIFIED",
    path: "a",
    label: "Frame",
    property: "minWidth",
    after: null,
  });
});
