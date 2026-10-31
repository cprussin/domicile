import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import DomicilePage from "./page";

test("the page tells its story in order: build, start from manganese, what you get, install, go deeper", () => {
  const html = renderToStaticMarkup(<DomicilePage />);
  const sections = [...html.matchAll(/<section[^>]* id="([^"]+)"/g)].map(
    ([, id]) => id,
  );
  expect(sections).toEqual([
    "top",
    "make",
    "swap",
    "manganese",
    "only",
    "batteries",
    "quickstart",
    "npm",
    "apps",
    "faq",
    "docs",
  ]);
});
