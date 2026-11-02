import { expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";

import { Compatibility } from "./Compatibility";

test("links the short support note to the compatibility page", () => {
  render(<Compatibility />);

  expect(screen.getByRole("link", { name: "What it runs on" })).toHaveAttribute(
    "href",
    "/docs/manganese/compatibility",
  );
});
