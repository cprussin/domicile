import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { PAGES } from "../../docs/pages";
import ManganesePage from "./page";

const html = renderToStaticMarkup(<ManganesePage />);

test("the reasons to pick manganese and a way to try it come before the keys", () => {
  const sections = [...html.matchAll(/<section[^>]* id="([^"]+)"/g)].map(
    ([, id]) => id,
  );
  expect(sections).toEqual([
    "top",
    "tour",
    "customize",
    "everything-else",
    "sway",
    "try",
    "keys",
    "install",
    "configure",
    "docs",
  ]);
});

test("every link on the page goes to a section or a docs page that exists", () => {
  const ids = new Set([...html.matchAll(/ id="([^"]+)"/g)].map(([, id]) => id));
  const docs = new Set(PAGES.map((page) => `/docs/${page.slug}`));
  const broken = [...html.matchAll(/ href="([^"]+)"/g)]
    .map(([, href]) => href ?? "")
    .filter((href) =>
      href.startsWith("#")
        ? !ids.has(href.slice(1))
        : href.startsWith("/docs/") && !docs.has(href.split("#")[0] ?? ""),
    );
  expect(broken).toEqual([]);
});
