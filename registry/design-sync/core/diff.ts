import type { DesignNode, DesignChange } from "./types.js";
import { stableSerialize } from "./hashing.js";
export function diffDesign(
  before: DesignNode,
  after: DesignNode,
): DesignChange[] {
  type Entry = {
    node: DesignNode;
    path: string;
    label: string;
    parent: string | null;
  };
  function index(root: DesignNode) {
    const result = new Map<string, Entry>();
    function walk(
      node: DesignNode,
      path: string,
      label: string,
      parent: string | null,
    ) {
      result.set(node.id, { node, path, label, parent });
      for (const child of node.children)
        walk(child, `${path}/${child.id}`, `${label}/${child.name}`, node.id);
    }
    walk(root, root.id, root.name, null);
    return result;
  }
  const old = index(before),
    current = index(after),
    changes: DesignChange[] = [];
  for (const [id, entry] of old)
    if (!current.has(id) && (!entry.parent || current.has(entry.parent)))
      changes.push({
        type: "REMOVED",
        path: entry.path,
        label: entry.label,
        before: entry.node.type,
      });
  for (const [id, entry] of current) {
    const previous = old.get(id);
    if (!previous) {
      if (!entry.parent || old.has(entry.parent))
        changes.push({
          type: "ADDED",
          path: entry.path,
          label: entry.label,
          after: entry.node.type,
        });
      continue;
    }
    const a = {
      type: previous.node.type,
      parent: previous.parent,
      childOrder: previous.node.children.map((n) => n.id),
      ...previous.node.properties,
    };
    const b = {
      type: entry.node.type,
      parent: entry.parent,
      childOrder: entry.node.children.map((n) => n.id),
      ...entry.node.properties,
    };
    for (const property of [
      ...new Set([...Object.keys(a), ...Object.keys(b)]),
    ].sort()) {
      const left = a[property as keyof typeof a],
        right = b[property as keyof typeof b];
      if (
        stableSerialize({ value: left }) !== stableSerialize({ value: right })
      )
        changes.push({
          type: "MODIFIED",
          path: entry.path,
          label: entry.label,
          property,
          ...(left !== undefined ? { before: left } : {}),
          ...(right !== undefined ? { after: right } : {}),
        });
    }
  }
  return changes;
}
