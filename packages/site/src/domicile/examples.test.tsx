import { describe, expect, test } from "bun:test";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { HeroMedia } from "./HeroMedia";
import { Quickstart } from "./Quickstart";

// The landing page's examples come in React and in plain JavaScript, as the
// docs' do.
describe.each<[string, ReactElement]>([
  ["the hero", <HeroMedia key="hero" />],
  ["the quickstart", <Quickstart key="quickstart" />],
])("%s", (_, section) => {
  test("has a React tab and a JavaScript tab", () => {
    const tabLists = [
      ...renderToStaticMarkup(section).matchAll(/role="tablist".*?<\/div>/gs),
    ].map(([list]) =>
      [...list.matchAll(/<button[^>]*role="tab"[^>]*>([^<]*)</g)].map(
        (match) => match[1],
      ),
    );
    expect(tabLists).toContainEqual(["React", "JavaScript"]);
  });
});
