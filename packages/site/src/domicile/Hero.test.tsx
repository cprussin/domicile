import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { Hero } from "./Hero";

test("right under its calls to action, the hero offers a trial in a window", () => {
  const html = renderToStaticMarkup(<Hero />);
  const trial = html.match(
    /Read the docs<\/span><\/a><\/div><p[^>]*><a[^>]* href="([^"]+)"[^>]*>Try it in a window<\/a> on your current Wayland desktop\.<\/p>/,
  );
  expect(trial?.[1]).toBe("/docs/install#try-it-first");
});
