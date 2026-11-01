import { expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Disclosure } from "./Disclosure";

test("folds its contents under a toggle naming what is shown", async () => {
  render(
    <Disclosure detail="How a shell works" label="Docs menu">
      <a href="/docs/install">Install</a>
    </Disclosure>,
  );
  const toggle = screen.getByText("Docs menu").closest("summary");
  expect(toggle?.textContent).toContain("How a shell works");
  expect(toggle?.parentElement?.hasAttribute("open")).toBe(false);

  await userEvent.click(toggle as HTMLElement);

  expect(toggle?.parentElement?.hasAttribute("open")).toBe(true);
});
