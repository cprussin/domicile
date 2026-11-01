// A docs page's sections, for its contents.

import type { Nodes } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

import { slugger } from "./slugger";
import { textOf } from "./text-of";

/** A `##` heading: what it says and the id it renders with. */
export type PageSection = { id: string; title: string };

/**
 * The `##` headings in `source`, in order. Ids count every heading before
 * them, as `Markdown` and GitHub number repeats.
 */
export const sectionsOf = (source: string): readonly PageSection[] => {
  const slug = slugger();
  return headings(
    fromMarkdown(source, {
      extensions: [gfm()],
      mdastExtensions: [gfmFromMarkdown()],
    }),
  ).flatMap((heading) => {
    const id = slug(textOf(heading));
    return heading.depth === 2 ? [{ id, title: textOf(heading) }] : [];
  });
};

/** Every heading under `node`, in document order. */
const headings = (node: Nodes): Extract<Nodes, { type: "heading" }>[] => {
  if (node.type === "heading") {
    return [node];
  } else {
    return "children" in node
      ? node.children.flatMap((child: Nodes) => headings(child))
      : [];
  }
};
