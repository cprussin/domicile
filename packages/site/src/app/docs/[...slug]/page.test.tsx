import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { sectionsFor } from "../../../docs/pages";
import DocPage from "./page";

const rendered = async (slug: string): Promise<string> =>
  renderToStaticMarkup(
    await DocPage({ params: Promise.resolve({ slug: slug.split("/") }) }),
  );

/** The `href`s inside the first `<details>` whose summary starts `label`. */
const linksUnder = (html: string, label: string): (string | undefined)[] => {
  const folded = new RegExp(
    `<details[^>]*><summary[^>]*><span[^>]*>${label}</span>.*?</details>`,
  ).exec(html)?.[0];
  if (folded === undefined) {
    throw new Error(`no disclosure labeled ${label}`);
  } else {
    return [...folded.matchAll(/ href="([^"]+)"/g)].map(([, href]) => href);
  }
};

describe("on a narrow screen", () => {
  test("every docs page is one tap away, in a folded docs menu", async () => {
    const html = await rendered("shells/writing");
    expect(linksUnder(html, "Docs menu")).toEqual(
      sectionsFor("domicile").flatMap((section) =>
        section.pages.map((page) => `/docs/${page.slug}`),
      ),
    );
  });
});

describe("contents", () => {
  test.each(["shells/writing", "shells/browser-windows", "shells/dialogs"])(
    "%s lists its sections, each landing on a heading",
    async (slug) => {
      const html = await rendered(slug);
      const links = linksUnder(html, "On this page");
      expect(links.length).toBeGreaterThanOrEqual(4);
      for (const link of links) {
        expect(html).toContain(` id="${link?.slice(1) ?? ""}"`);
      }
    },
  );

  test("a page with few sections has none", async () => {
    expect(await rendered("shells/idle-and-lock")).not.toContain(
      "On this page",
    );
  });
});
