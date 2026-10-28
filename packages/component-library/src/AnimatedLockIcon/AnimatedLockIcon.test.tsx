import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";

import { AnimatedLockIcon } from "./AnimatedLockIcon";

describe(AnimatedLockIcon, () => {
  it("draws a body, a shackle that moves on its own, and a keyhole", () => {
    const { container } = render(<AnimatedLockIcon label="Secure" size={14} />);
    expect(screen.getByRole("img", { name: "Secure" })).toBeInTheDocument();
    expect(
      [...container.querySelectorAll("[data-part]")].map((part) =>
        part.getAttribute("data-part"),
      ),
    ).toEqual(["body", "shackle", "keyhole"]);
  });
});
