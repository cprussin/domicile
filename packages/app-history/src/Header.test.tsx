import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";

import { Header } from "./Header";

describe(Header, () => {
  // The app's directory holds only the built module, so a mark loaded by
  // relative URL is a broken image.
  it("carries its mark in the module", () => {
    render(
      <Header
        onClearData={() => undefined}
        onSearch={() => undefined}
        scrolled={false}
        search=""
      />,
    );
    expect(screen.getByRole("presentation").getAttribute("src")).toStartWith(
      "data:image/svg+xml",
    );
  });
});
