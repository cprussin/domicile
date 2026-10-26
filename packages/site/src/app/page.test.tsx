import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import DomicilePage from "./page";

test("the hero links to each main section of the page", () => {
  const html = renderToStaticMarkup(<DomicilePage />);
  const links = html.match(/<nav aria-label="On this page".*?<\/nav>/s)?.[0];
  const targets = [...(links ?? "").matchAll(/href="#([^"]+)"/g)].map(
    ([, id]) => id,
  );
  expect(targets).toEqual(["css", "batteries", "apps", "npm", "manganese"]);
  for (const id of targets) {
    expect(html).toContain(`id="${id}"`);
  }
});
