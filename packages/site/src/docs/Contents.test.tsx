import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { Contents } from "./Contents";

test("links each section to its heading, under a landmark of its own", () => {
  const html = renderToStaticMarkup(
    <Contents
      sections={[
        { id: "focus", title: "Focus" },
        { id: "new-windows", title: "New windows" },
      ]}
    />,
  );
  expect(html).toMatch(/^<nav aria-label="On this page"/);
  expect(
    [...html.matchAll(/<a[^>]* href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map(
      ([, href, title]) => [href, title],
    ),
  ).toEqual([
    ["#focus", "Focus"],
    ["#new-windows", "New windows"],
  ]);
});
