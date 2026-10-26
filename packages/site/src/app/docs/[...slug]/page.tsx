import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { css } from "../../../../styled-system/css";
import { grid } from "../../../../styled-system/patterns";
import { Markdown } from "../../../docs/Markdown";
import {
  PAGES,
  pageAt,
  productOf,
  REPO_ROOT,
  sectionsFor,
} from "../../../docs/pages";
import { Sidebar } from "../../../docs/Sidebar";
import { DomicileMark } from "../../../domicile/DomicileMark";
import { ManganeseMark } from "../../../manganese/ManganeseMark";
import type { ProductName } from "../../../page/Accent";
import { Accent } from "../../../page/Accent";
import { REPO, repoFile } from "../../../page/repo";
import { SiteFooter } from "../../../page/SiteFooter";
import { SiteHeader } from "../../../page/SiteHeader";

type Params = { params: Promise<{ slug: string[] }> };

/** Every page is built ahead; a route no page has is a 404. */
export const dynamicParams = false;

export const generateStaticParams = () =>
  PAGES.map((page) => ({ slug: page.slug.split("/") }));

export const generateMetadata = async ({
  params,
}: Params): Promise<Metadata> => ({
  title: pageAt((await params).slug)?.title,
});

/** domicile-desktop.com/docs/…: a repository markdown file, with the sidebar. */
const DocPage = async ({ params }: Params) => {
  const page = pageAt((await params).slug);
  if (page === undefined) {
    notFound();
  }
  const product = productOf(page.slug);
  const chrome = CHROME[product];
  return (
    <Accent product={product}>
      <SiteHeader
        action={chrome.action}
        brand={chrome.brand}
        links={chrome.links}
      />
      <div className={layoutStyles}>
        <aside className={asideStyles}>
          <Sidebar current={page.slug} sections={sectionsFor(product)} />
        </aside>
        <main className={mainStyles}>
          <Markdown
            from={page.source}
            pages={PAGES}
            source={readFileSync(join(REPO_ROOT, page.source), "utf8")}
          />
          <a className={editStyles} href={repoFile(page.source)}>
            This page on GitHub
          </a>
        </main>
      </div>
      <SiteFooter
        links={[
          { href: REPO, label: "GitHub" },
          { href: repoFile("LICENSE"), label: "MIT license" },
        ]}
      >
        <span>{chrome.footer}</span>
      </SiteFooter>
    </Accent>
  );
};

type Link = { href: string; label: string };

/** Each product's header and footer, as on its landing page. */
const CHROME: Record<
  ProductName,
  { action: Link; brand: ReactNode; footer: ReactNode; links: Link[] }
> = {
  domicile: {
    action: { href: "/docs/shells/quickstart", label: "Quickstart" },
    brand: <DomicileMark />,
    footer: (
      <>
        Domicile runs <a href="/manganese">manganese</a>, its reference shell.
      </>
    ),
    links: [
      { href: "/", label: "Domicile" },
      { href: "/manganese", label: "Manganese" },
      { href: REPO, label: "GitHub" },
    ],
  },
  manganese: {
    action: { href: "/docs/manganese/install", label: "Install" },
    brand: <ManganeseMark />,
    footer: (
      <>
        Manganese is the reference shell for <a href="/">Domicile</a>.
      </>
    ),
    links: [
      { href: "/manganese", label: "Manganese" },
      { href: "/", label: "Domicile" },
      { href: REPO, label: "GitHub" },
    ],
  },
};

export default DocPage;

const layoutStyles = grid({
  columnGap: 12,
  gridTemplateColumns: { base: "1fr", md: "14rem minmax(0, 1fr)" },
  marginInline: "auto",
  maxInlineSize: "6xl",
  paddingBlock: 8,
  paddingInline: 6,
  rowGap: 8,
});

const asideStyles = css({
  alignSelf: "start",
  position: { md: "sticky" },
  top: { md: 6 },
});

const mainStyles = css({
  display: "flex",
  flexDirection: "column",
  gap: 10,
  maxInlineSize: "3xl",
  minInlineSize: 0,
  paddingBlockEnd: 20,
});

const editStyles = css({
  _hover: { color: "accent" },
  color: "muted",
  fontSize: "sm",
});
