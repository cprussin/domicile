import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { DocTabs } from "./DocTabs";

// The tabs fill their parent's height, as an app's do, and may shrink below
// their content. In a docs page's flex column that let the page squeeze them,
// so the code under a tab overlapped what came after. A plain block around them
// keeps them at their content's height, and spaces the panel off the tab bar.
test("the tabs sit in a styled block of their own", () => {
  const html = renderToStaticMarkup(
    <DocTabs tabs={[{ content: "one", label: "React" }]} />,
  );
  expect(html).toMatch(/^<div class="[^"]*"><div[^>]*class="[^"]*"/);
});
