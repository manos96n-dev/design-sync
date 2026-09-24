import { z } from "zod";
import type { DesignNode, Json } from "../core/types.js";
import { DesignSyncError } from "../core/errors.js";
const rawSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    type: z.string(),
    devStatus: z
      .object({
        type: z.enum(["READY_FOR_DEV", "COMPLETED"]),
        description: z.string().optional(),
      })
      .nullable()
      .optional(),
    children: z.array(z.unknown()).optional(),
  })
  .passthrough();
// Explicit allowlist: editor metadata cannot accidentally change a revision.
const properties =
  `visible locked rotation preserveRatio constraints layoutAlign layoutGrow layoutPositioning layoutMode primaryAxisSizingMode counterAxisSizingMode primaryAxisAlignItems counterAxisAlignItems counterAxisAlignContent paddingLeft paddingRight paddingTop paddingBottom itemSpacing counterAxisSpacing layoutWrap layoutSizingHorizontal layoutSizingVertical minWidth maxWidth minHeight maxHeight clipsContent overflowDirection fills strokes strokeWeight individualStrokeWeights strokeAlign strokeJoin strokeCap strokeMiterAngle strokeDashes cornerRadius rectangleCornerRadii cornerSmoothing effects opacity blendMode isMask maskType characters style characterStyleOverrides styleOverrideTable lineTypes lineIndentations componentId componentProperties componentPropertyDefinitions componentPropertyReferences overrides boundVariables explicitVariableModes styles fillGeometry strokeGeometry arcData booleanOperation dashPattern gridRowCount gridColumnCount gridRowGap gridColumnGap gridRowsSizing gridColumnsSizing gridChildHorizontalAlign gridChildVerticalAlign gridRowSpan gridColumnSpan gridRowAnchorIndex gridColumnAnchorIndex`.split(
    " ",
  );
const knownTypes = new Set(
  "DOCUMENT CANVAS FRAME GROUP VECTOR BOOLEAN_OPERATION STAR LINE ELLIPSE REGULAR_POLYGON RECTANGLE TEXT SLICE COMPONENT COMPONENT_SET INSTANCE SECTION".split(
    " ",
  ),
);
function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}
function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function normalizeFigma(raw: unknown): DesignNode {
  const seen = new Set<string>();
  function visit(value: unknown, parent?: Record<string, unknown>): DesignNode {
    const source = rawSchema.parse(value);
    if (seen.has(source.id))
      throw new DesignSyncError(
        "INVALID_PROVIDER_DATA",
        `Duplicate Figma node ID ${source.id}`,
      );
    seen.add(source.id);
    for (const key of [
      "opacity",
      "rotation",
      "strokeWeight",
      "cornerRadius",
      "cornerSmoothing",
      "paddingLeft",
      "paddingRight",
      "paddingTop",
      "paddingBottom",
      "itemSpacing",
      "layoutGrow",
      "minWidth",
      "maxWidth",
      "minHeight",
      "maxHeight",
    ]) {
      if (source[key] !== undefined && source[key] !== null)
        z.number().finite().parse(source[key]);
    }
    for (const key of ["visible", "clipsContent", "isMask", "preserveRatio"])
      if (source[key] !== undefined) z.boolean().parse(source[key]);
    if (source.characters !== undefined) z.string().parse(source.characters);
    if (source.style !== undefined)
      z.record(z.string(), z.json()).parse(source.style);
    for (const key of [
      "fills",
      "strokes",
      "effects",
      "fillGeometry",
      "strokeGeometry",
    ])
      if (source[key] !== undefined)
        z.array(z.record(z.string(), z.json())).parse(source[key]);
    if (source.absoluteBoundingBox !== undefined)
      z.object({
        x: z.number().finite(),
        y: z.number().finite(),
        width: z.number().finite(),
        height: z.number().finite(),
      }).parse(source.absoluteBoundingBox);
    const props: Record<string, Json> = {};
    const issues: string[] = [];
    for (const key of properties)
      if (source[key] !== undefined) props[key] = z.json().parse(source[key]);
    // Figma omits these properties when their default applies.
    props.visible ??= true;
    props.opacity ??= 1;
    props.blendMode ??= "PASS_THROUGH";
    delete props.locked; // Editing lock is not a rendered property.
    const bounds = record(source.absoluteBoundingBox),
      parentBounds = record(parent?.absoluteBoundingBox),
      size = record(source.size);
    const width = number(size.x) ?? number(bounds.width),
      height = number(size.y) ?? number(bounds.height);
    if (width !== undefined) props.width = width;
    if (height !== undefined) props.height = height;
    const transform = source.relativeTransform;
    if (
      Array.isArray(transform) &&
      transform.length === 2 &&
      transform.every(
        (row) =>
          Array.isArray(row) &&
          row.length === 3 &&
          row.every((v) => typeof v === "number" && Number.isFinite(v)),
      )
    ) {
      const matrix = structuredClone(transform) as number[][];
      if (!parent) {
        matrix[0]![2] = 0;
        matrix[1]![2] = 0;
      }
      props.transform = matrix;
    } else if (
      parent &&
      number(bounds.x) !== undefined &&
      number(parentBounds.x) !== undefined &&
      number(bounds.y) !== undefined &&
      number(parentBounds.y) !== undefined
    ) {
      props.x = (bounds.x as number) - (parentBounds.x as number);
      props.y = (bounds.y as number) - (parentBounds.y as number);
    }
    if (!knownTypes.has(source.type))
      issues.push(`UNSUPPORTED_NODE:${source.type}`);
    if (
      source.type === "VECTOR" &&
      source.fillGeometry === undefined &&
      source.strokeGeometry === undefined
    )
      issues.push("VECTOR_GEOMETRY_MISSING");
    const children = (source.children ?? []).map((child) =>
      visit(child, source),
    );
    return {
      id: source.id,
      name: source.name,
      type: source.type,
      devStatus: source.devStatus ?? null,
      properties: props,
      children,
      issues: [...issues, ...children.flatMap((c) => c.issues)],
    };
  }
  return visit(raw);
}
