import { expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

// Picking a tab picks it in every set on the page, so a set above can grow and
// push the one picked down the page. The page scrolls to keep it in place.
test("the tabs picked stay where they were on the page", async () => {
  render(
    <>
      <DocTabs
        tabs={[
          { content: "short", label: "React" },
          { content: "long", label: "JavaScript" },
        ]}
      />
      <DocTabs
        tabs={[
          { content: "one", label: "React" },
          { content: "two", label: "JavaScript" },
        ]}
      />
    </>,
  );
  const [, below] = screen.getAllByRole("tablist");
  const frame = below?.closest("[role=tablist]")?.parentElement?.parentElement;
  if (frame === null || frame === undefined) {
    throw new Error("no frame around the tabs");
  }
  // The set above grows by 1600px when it shows JavaScript.
  frame.getBoundingClientRect = () =>
    DOMRect.fromRect({
      y: (screen.queryByText("long") === null ? 300 : 1900) - window.scrollY,
    });

  const [, picked] = screen.getAllByRole("tab", { name: "JavaScript" });
  if (picked === undefined) {
    throw new Error("no second JavaScript tab");
  }
  await userEvent.click(picked);

  expect(frame.getBoundingClientRect().top).toBe(300);
});
