import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { Sidebar } from "./Sidebar";

const SECTIONS = [
  {
    pages: [
      { slug: "manganese/keys", source: "KEYS.md", title: "Keys" },
      { slug: "manganese/lock", source: "LOCK.md", title: "Locking" },
    ],
    product: "manganese" as const,
    title: "Use it",
  },
];

test("links every page, marking the one being read", () => {
  const html = renderToStaticMarkup(
    <Sidebar current="manganese/lock" sections={SECTIONS} />,
  );
  expect(html).toMatch(/<a[^>]*href="\/docs\/manganese\/keys"[^>]*>Keys<\/a>/);
  expect(html).toMatch(
    /<a[^>]*aria-current="page"[^>]*href="\/docs\/manganese\/lock"[^>]*>Locking<\/a>/,
  );
  expect(html).not.toMatch(/aria-current="page"[^>]*>Keys/);
});
