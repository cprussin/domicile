// Where a link in a repository markdown file goes on the site: to
// another docs page when the docs render its target, else to the file on
// GitHub.

import { posix } from "node:path";

import { repoFile } from "../page/repo";

/** A docs page, by the route it gets and the file it renders. */
export type Routed = { slug: string; source: string };

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
  const page = pages.find((candidate) => candidate.source === target);
  const anchor = hash === undefined ? "" : `#${hash}`;
  return page === undefined
    ? `${repoFile(target)}${anchor}`
    : `/docs/${page.slug}${anchor}`;
};

const isElsewhere = (href: string): boolean => /^[a-z]+:/i.test(href);

/** A path from the repository root; a leading `/` is the root already. */
const inRepo = (path: string, from: string): string =>
  path.startsWith("/") ? path.slice(1) : posix.join(posix.dirname(from), path);
