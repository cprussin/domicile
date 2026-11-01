import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { css, cva } from "../../../../styled-system/css";
import { Contents } from "../../../docs/Contents";
import { Disclosure } from "../../../docs/Disclosure";
import { Markdown } from "../../../docs/Markdown";
import {
  PAGES,
  pageAt,
  productOf,
  REPO_ROOT,
  sectionsFor,
} from "../../../docs/pages";
import { Sidebar } from "../../../docs/Sidebar";
import { sectionsOf } from "../../../docs/sections";
import { DomicileMark } from "../../../domicile/DomicileMark";
import { ManganeseMark } from "../../../manganese/ManganeseMark";
import type { ProductName } from "../../../page/Accent";
import { Accent } from "../../../page/Accent";
import { repoFile } from "../../../page/repo";
import { SiteFooter } from "../../../page/SiteFooter";
import { SiteHeader } from "../../../page/SiteHeader";

/** Fewer `##` sections than this fit on a screen, so need no contents. */
const MIN_SECTIONS = 4;

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
  const source = readFileSync(join(REPO_ROOT, page.source), "utf8");
  const sidebar = (
    <Sidebar current={page.slug} sections={sectionsFor(product)} />
  );
  const sections = sectionsOf(source);
  const contents =
    sections.length >= MIN_SECTIONS ? (
      <Contents sections={sections} />
    ) : undefined;
  return (
    <Accent product={product}>
      <SiteHeader
        action={chrome.action}
        brand={chrome.brand}
        links={chrome.links}
      />
      <div className={layoutStyles({ contents: contents !== undefined })}>
        <aside className={asideStyles}>{sidebar}</aside>
        <main className={mainStyles}>
          <div className={foldedStyles({ contents: contents !== undefined })}>
            <div className={narrowOnlyStyles}>
              <Disclosure detail={page.title} label="Docs menu">
                {sidebar}
              </Disclosure>
            </div>
            {contents === undefined ? undefined : (
              <div className={belowRailStyles}>
                <Disclosure
                  detail={`${sections.length.toString()} sections`}
                  label="On this page"
                >
                  {contents}
                </Disclosure>
              </div>
            )}
          </div>
          <Markdown from={page.source} pages={PAGES} source={source} />
          <a className={editStyles} href={repoFile(page.source)}>
            This page on GitHub
          </a>
        </main>
        {contents === undefined ? undefined : (
          <aside className={railStyles}>
            <span className={railTitleStyles}>On this page</span>
            {contents}
          </aside>
        )}
      </div>
      <SiteFooter links={[{ href: repoFile("LICENSE"), label: "MIT license" }]}>
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
    ],
  },
};

export default DocPage;

// Sidebar and article from `md`; contents get a third column from `xl`, with
// a wider page to make room for it.
const layoutStyles = cva({
  base: {
    columnGap: 12,
    display: "grid",
    gridTemplateColumns: { base: "minmax(0, 1fr)", md: "14rem minmax(0, 1fr)" },
    marginInline: "auto",
    maxInlineSize: "6xl",
    paddingBlock: 8,
    paddingInline: 6,
    rowGap: 8,
  },
  variants: {
    contents: {
      false: {},
      true: {
        gridTemplateColumns: {
          base: "minmax(0, 1fr)",
          md: "14rem minmax(0, 1fr)",
          xl: "14rem minmax(0, 1fr) 12rem",
        },
        maxInlineSize: { base: "6xl", xl: "7xl" },
      },
    },
  },
});

// The whole sidebar from `md`; below it, the docs menu stands in.
const asideStyles = css({
  alignSelf: "start",
  display: { base: "none", md: "block" },
  position: { md: "sticky" },
  top: { md: 6 },
});

// Hidden where every disclosure in it is, so it adds no gap above the article.
const foldedStyles = cva({
  base: { flexDirection: "column", gap: 2 },
  variants: {
    contents: {
      false: { display: { base: "flex", md: "none" } },
      true: { display: { base: "flex", xl: "none" } },
    },
  },
});

const narrowOnlyStyles = css({ display: { md: "none" } });

const belowRailStyles = css({ display: { xl: "none" } });

const railStyles = css({
  alignSelf: "start",
  borderInlineStart: "1px solid {colors.border}",
  display: { base: "none", xl: "flex" },
  flexDirection: "column",
  gap: 3,
  maxBlockSize: "calc(100dvh - {spacing.12})",
  overflowY: "auto",
  paddingInlineStart: 4,
  position: "sticky",
  top: 6,
});

const railTitleStyles = css({ fontSize: "sm", fontWeight: "semibold" });

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
