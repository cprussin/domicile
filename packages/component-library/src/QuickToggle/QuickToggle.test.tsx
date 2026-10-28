import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { QuickToggle } from "./QuickToggle";

describe(QuickToggle, () => {
  it("is a toggle named by its label", () => {
    render(
      <QuickToggle
        icon={<span />}
        label="Night light"
        onPressedChange={() => undefined}
        pressed
      />,
    );

    expect(screen.getByRole("button", { name: "Night light" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("asks for the other state when pressed", async () => {
    const asked = await new Promise((resolve) => {
      render(
        <QuickToggle
          icon={<span />}
          label="Keep awake"
          onPressedChange={resolve}
          pressed={false}
        />,
      );
      void userEvent.click(screen.getByRole("button", { name: "Keep awake" }));
    });

    expect(asked).toBe(true);
  });

  it("explains itself in a tooltip", async () => {
    render(
      <QuickToggle
        detail="Kept on by Firefox"
        icon={<span />}
        label="Keep awake"
        onPressedChange={() => undefined}
        pressed={false}
      />,
    );

    await userEvent.hover(screen.getByRole("button", { name: "Keep awake" }));

    expect(
      await screen.findByRole("tooltip", {}, { timeout: 2000 }),
    ).toHaveTextContent("Kept on by Firefox");
  });

  it("ignores presses while disabled", () => {
    render(
      <QuickToggle
        disabled
        icon={<span />}
        label="Keep awake"
        onPressedChange={() => undefined}
        pressed
      />,
    );

    expect(screen.getByRole("button", { name: "Keep awake" })).toBeDisabled();
  });
});
