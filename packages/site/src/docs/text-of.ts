import type { Nodes } from "mdast";

/** The plain text inside a markdown node, as a heading's id is made from. */
export const textOf = (node: Nodes): string => {
  if ("value" in node) {
    return node.value;
  } else {
    return "children" in node
      ? node.children.map((child: Nodes) => textOf(child)).join("")
      : "";
  }
};
