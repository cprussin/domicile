// Where a link in a repository markdown file goes on the site: to
// another docs page when the docs render its target, else to the file on
// GitHub.

import { posix } from "node:path";

import { repoFile } from "../page/repo";

/** A docs page, by the route it gets, the file it renders and its title. */
export type Routed = { slug: string; source: string; title: string };

/** `href`, written in the file `from`, as a link on the site. */
export const resolveHref = (
  href: string,
  from: string,
  pages: readonly Routed[],
): string => {
  if (isElsewhere(href) || href.startsWith("#")) {
    return href;
  }
  const [path = "", hash] = href.split("#");
  const target = inRepo(path, from);
  const page = pageFor(target, pages);
  const anchor = hash === undefined ? "" : `#${hash}`;
  return page === undefined
    ? `${repoFile(target)}${anchor}`
    : `/docs/${page.slug}${anchor}`;
};

/**
 * What a link reads as: the title of the docs page it goes to when its
 * words are only that page's file name, as GitHub links are written, else
 * `text`.
 */
export const linkLabel = (
  text: string,
  href: string,
  from: string,
  pages: readonly Routed[],
): string => {
  if (isElsewhere(href) || href.startsWith("#")) {
    return text;
  }
  const target = inRepo(href.split("#")[0] ?? "", from);
  const page = pageFor(target, pages);
  const named =
    posix.basename(text.split("#")[0] ?? "") === posix.basename(target);
  return page !== undefined && named ? page.title : text;
};

const pageFor = (target: string, pages: readonly Routed[]) =>
  pages.find((candidate) => candidate.source === target);

const isElsewhere = (href: string): boolean => /^[a-z]+:/i.test(href);

/** A path from the repository root; a leading `/` is the root already. */
const inRepo = (path: string, from: string): string =>
  path.startsWith("/") ? path.slice(1) : posix.join(posix.dirname(from), path);
