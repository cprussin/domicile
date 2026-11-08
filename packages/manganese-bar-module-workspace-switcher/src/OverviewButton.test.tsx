import { describe, expect, it } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { OverviewButton } from "./OverviewButton";

describe("OverviewButton", () => {
  it("opens the overview", async () => {
    await new Promise<void>((resolve) => {
      render(<OverviewButton onToggle={resolve} open={false} />);
      fireEvent.click(screen.getByRole("button", { name: "Overview" }));
    });
  });

  it("shows four squares, the workspaces at once", () => {
    const { container } = render(
      <OverviewButton onToggle={() => undefined} open={false} />,
    );
    expect(container.querySelectorAll("[data-part=square]")).toHaveLength(4);
  });

  it("stays lit while the overview is open", () => {
    render(<OverviewButton onToggle={() => undefined} open />);
    expect(
      screen
        .getByRole("button", { name: "Overview" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("names itself on hover", async () => {
    render(<OverviewButton onToggle={() => undefined} open={false} />);
    await userEvent.hover(screen.getByRole("button", { name: "Overview" }));
    expect(
      await screen.findByRole("tooltip", {}, { timeout: 2000 }),
    ).toHaveTextContent("Overview");
  });
});
