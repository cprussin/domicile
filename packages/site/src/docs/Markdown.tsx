import type { Nodes, RootContent } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

import { css } from "../../styled-system/css";
import { CodeBlock } from "../code/CodeBlock";
import type { Language } from "../code/highlight";
import type { Routed } from "./links";
import { resolveHref } from "./links";
import { slugger } from "./slugger";

type Props = {
  /** The markdown. */
  source: string;
  /** Its path in the repository, which its relative links start from. */
  from: string;
  /** The docs pages, which its links to them go to. */
  pages: readonly Routed[];
};

/** A repository markdown file as a docs page's body, rendered at build time. */
export const Markdown = ({ source, from, pages }: Props) => {
  const tree = fromMarkdown(source, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
  const context: Context = { from, pages, slug: slugger() };
  return <div className={bodyStyles}>{nodes(tree.children, context)}</div>;
};

type Context = {
  from: string;
  pages: readonly Routed[];
  slug: (text: string) => string;
};

const nodes = (children: readonly RootContent[], context: Context) =>
  // Siblings never reorder, so their positions are stable keys.
  children.map((child, at) => <Node context={context} key={at} node={child} />);

const Node = ({ node, context }: { node: RootContent; context: Context }) => {
  switch (node.type) {
    case "heading": {
      const Tag = HEADINGS[node.depth - 1] ?? "h6";
      return (
        <Tag className={headingStyles} id={context.slug(textOf(node))}>
          {nodes(node.children, context)}
        </Tag>
      );
    }
    case "paragraph": {
      return <p className={paragraphStyles}>{nodes(node.children, context)}</p>;
    }
    case "text": {
      return node.value;
    }
    case "emphasis": {
      return <em>{nodes(node.children, context)}</em>;
    }
    case "strong": {
      return <strong>{nodes(node.children, context)}</strong>;
    }
    case "delete": {
      return <del>{nodes(node.children, context)}</del>;
    }
    case "inlineCode": {
      return <code className={inlineCodeStyles}>{node.value}</code>;
    }
    case "break": {
      return <br />;
    }
    case "link": {
      return (
        <a
          className={linkStyles}
          href={resolveHref(node.url, context.from, context.pages)}
        >
          {nodes(node.children, context)}
        </a>
      );
    }
    case "code": {
      return (
        <div className={blockStyles}>
          <CodeBlock code={node.value} language={languageOf(node.lang)} />
        </div>
      );
    }
    case "list": {
      return node.ordered === true ? (
        <ol className={listStyles} start={node.start ?? undefined}>
          {nodes(node.children, context)}
        </ol>
      ) : (
        <ul className={listStyles}>{nodes(node.children, context)}</ul>
      );
    }
    case "listItem": {
      // A tight list's items hold bare text, not paragraphs.
      return (
        <li className={itemStyles}>
          {node.spread
            ? nodes(node.children, context)
            : node.children.flatMap((child, at) =>
                child.type === "paragraph" ? (
                  nodes(child.children, context)
                ) : (
                  <Node context={context} key={at} node={child} />
                ),
              )}
        </li>
      );
    }
    case "blockquote": {
      return (
        <blockquote className={quoteStyles}>
          {nodes(node.children, context)}
        </blockquote>
      );
    }
    case "thematicBreak": {
      return <hr className={ruleStyles} />;
    }
    case "table": {
      const [head, ...body] = node.children;
      const cells = (row: typeof head, Cell: "td" | "th") =>
        row?.children.map((cell, at) => (
          <Cell
            className={cellStyles}
            data-align={node.align?.[at] ?? undefined}
            key={at}
          >
            {nodes(cell.children, context)}
          </Cell>
        ));
      return (
        <div className={tableWrapStyles}>
          <table className={tableStyles}>
            <thead>
              <tr>{cells(head, "th")}</tr>
            </thead>
            <tbody>
              {body.map((row, at) => (
                <tr key={at}>{cells(row, "td")}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    default: {
      // Raw HTML, images, footnotes and definitions: the docs use none.
      return undefined;
    }
  }
};

const HEADINGS = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;

/** The plain text inside a node, for a heading's id. */
const textOf = (node: Nodes): string => {
  if ("value" in node) {
    return node.value;
  }
  return "children" in node
    ? node.children.map((child: Nodes) => textOf(child)).join("")
    : "";
};

/** A fence's language as `CodeBlock` names it; anything else is plain. */
const languageOf = (lang: string | null | undefined): Language =>
  LANGUAGES[lang ?? ""] ?? "plain";

const LANGUAGES: Readonly<Record<string, Language>> = {
  bash: "bash",
  css: "css",
  json: "json",
  sh: "bash",
  ts: "tsx",
  tsx: "tsx",
};

const bodyStyles = css({
  color: "foreground",
  display: "flex",
  flexDirection: "column",
  fontSize: "md",
  gap: 4,
  lineHeight: "relaxed",
  minInlineSize: 0,
});

const headingStyles = css({
  "&:is(h1)": { fontSize: "4xl", marginBlockEnd: 2 },
  "&:is(h2)": {
    borderBlockStart: "1px solid {colors.border}",
    fontSize: "2xl",
    marginBlockStart: 6,
    paddingBlockStart: 6,
  },
  "&:is(h3)": { fontSize: "xl", marginBlockStart: 4 },
  "&:is(h4, h5, h6)": { fontSize: "lg", marginBlockStart: 2 },
  fontFamily: "display",
  fontWeight: "semibold",
  letterSpacing: "tight",
  lineHeight: "tight",
  scrollMarginBlockStart: 6,
});

const paragraphStyles = css({ margin: 0 });

const inlineCodeStyles = css({
  backgroundColor: "card",
  border: "1px solid {colors.border}",
  borderRadius: "sm",
  fontFamily: "code",
  fontSize: "0.875em",
  paddingInline: 1,
});

const linkStyles = css({
  _hover: { textDecorationThickness: "2px" },
  color: "accent",
  textDecoration: "underline",
  textUnderlineOffset: "2px",
});

const blockStyles = css({ minInlineSize: 0 });

const listStyles = css({
  display: "flex",
  flexDirection: "column",
  gap: 1.5,
  margin: 0,
  "ol&": { listStyleType: "decimal" },
  paddingInlineStart: 6,
  "ul&": { listStyleType: "disc" },
});

const itemStyles = css({
  "& > :is(ul, ol)": { marginBlockStart: 1.5 },
});

const quoteStyles = css({
  borderInlineStart: "3px solid {colors.accent}",
  color: "muted",
  margin: 0,
  paddingInlineStart: 4,
});

const ruleStyles = css({
  border: 0,
  borderBlockStart: "1px solid {colors.border}",
  marginBlock: 2,
});

const tableWrapStyles = css({ overflowX: "auto" });

const tableStyles = css({
  borderCollapse: "collapse",
  fontSize: "sm",
  inlineSize: "full",
});

const cellStyles = css({
  "&[data-align=center]": { textAlign: "center" },
  "&[data-align=right]": { textAlign: "right" },
  borderBlockEnd: "1px solid {colors.border}",
  paddingBlock: 2,
  paddingInline: 3,
  textAlign: "left",
  verticalAlign: "top",
});
