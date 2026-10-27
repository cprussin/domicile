import { describe, expect, test } from "bun:test";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Apps } from "./Apps";
import { HeroMedia } from "./HeroMedia";
import { Platform } from "./Platform";
import { Quickstart } from "./Quickstart";

// The landing page's examples come in React and in plain JavaScript, as the
// docs' do.
describe.each<[string, ReactElement]>([
  ["the hero", <HeroMedia key="hero" />],
  ["the platform", <Platform key="platform" />],
  ["the quickstart", <Quickstart key="quickstart" />],
  ["apps", <Apps key="apps" />],
])("%s", (_, section) => {
  test("has a React tab and a JavaScript tab", () => {
    const tabs = [
      ...renderToStaticMarkup(section).matchAll(
        /<button[^>]*role="tab"[^>]*>([^<]*)</g,
      ),
    ].map((match) => match[1]);
    expect(tabs).toEqual(["React", "JavaScript"]);
  });
});
