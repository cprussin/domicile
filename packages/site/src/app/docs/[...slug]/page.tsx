import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { css } from "../../../../styled-system/css";
import { grid } from "../../../../styled-system/patterns";
import { Markdown } from "../../../docs/Markdown";
import { PAGES, pageAt, REPO_ROOT, SECTIONS } from "../../../docs/pages";
import { Sidebar } from "../../../docs/Sidebar";
import { ManganeseMark } from "../../../manganese/ManganeseMark";
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
  return (
    <Accent product="manganese">
      <SiteHeader
        action={{ href: "/manganese#install", label: "Install" }}
        brand={<ManganeseMark />}
        links={[
          { href: "/manganese", label: "Manganese" },
          { href: "/", label: "Domicile" },
          { href: REPO, label: "GitHub" },
        ]}
      />
      <div className={layoutStyles}>
        <aside className={asideStyles}>
          <Sidebar current={page.slug} sections={SECTIONS} />
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
        <span>
          Manganese is the reference shell for <a href="/">Domicile</a>.
        </span>
      </SiteFooter>
    </Accent>
  );
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
