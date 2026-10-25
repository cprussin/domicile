import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";

import { CountBadge } from "./CountBadge";

describe(CountBadge, () => {
  it("shows the count, hidden from assistive tech", () => {
    render(<CountBadge count={3} />);
    expect(screen.getByText("3")).toHaveAttribute("aria-hidden", "true");
  });

  it("stops counting where the badge has room", () => {
    render(<CountBadge count={42} />);
    expect(screen.getByText("9+")).toBeInTheDocument();
  });

  it("shows nothing for zero", () => {
    const { container } = render(<CountBadge count={0} />);
    expect(container).toBeEmptyDOMElement();
  });
});
