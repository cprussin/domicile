import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";

import { Card } from "./Card";

describe(Card, () => {
  it("renders its children", () => {
    render(
      <Card>
        <span data-testid="body">hi</span>
      </Card>,
    );
    expect(screen.getByTestId("body")).toBeInTheDocument();
  });

  it("names itself a region with its heading when given a title", () => {
    render(
      <Card title="Settings">
        <span />
      </Card>,
    );
    expect(
      screen.getByRole("heading", { name: "Settings" }),
    ).toBeInTheDocument();
    // The heading names the section, so it surfaces as a landmark region.
    expect(
      screen.getByRole("region", { name: "Settings" }),
    ).toBeInTheDocument();
  });

  it("stays an unnamed section without a title", () => {
    render(
      <Card>
        <span data-testid="body">hi</span>
      </Card>,
    );
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    // No accessible name means no landmark — just generic sectioning content.
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("forwards additional props to the underlying element", () => {
    render(
      <Card aria-label="Preferences" data-testid="surface">
        <span />
      </Card>,
    );
    expect(screen.getByTestId("surface")).toHaveAttribute(
      "aria-label",
      "Preferences",
    );
  });
});
