import { describe, expect, it } from "bun:test";
import { WorkspacesContext } from "@domicile-desktop/manganese-window-management/workspaces-context";
import { render, screen } from "@testing-library/react";

import { Mode } from "./bar-item";

/** The mode item under binding mode `mode`. */
const inMode = (mode: string) =>
  render(
    <WorkspacesContext
      value={{
        current: {},
        focused: "left",
        homes: {},
        mode,
        select: () => undefined,
      }}
    >
      <Mode />
    </WorkspacesContext>,
  );

describe("Mode", () => {
  it("names a binding mode other than the default", () => {
    inMode("resize");

    expect(screen.getByText("resize")).toBeInTheDocument();
  });

  it("shows nothing in the default mode", () => {
    const { container } = inMode("default");

    expect(container).toBeEmptyDOMElement();
  });
});
