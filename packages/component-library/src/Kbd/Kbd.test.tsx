import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";

import { Kbd } from "./Kbd";

describe(Kbd, () => {
  it("renders children inside a kbd element", () => {
    render(<Kbd>Enter</Kbd>);
    const el = screen.getByText("Enter");
    expect(el.tagName).toBe("KBD");
  });

  it("forwards additional props to the underlying element", () => {
    render(<Kbd title="Return key">Enter</Kbd>);
    expect(screen.getByText("Enter")).toHaveAttribute("title", "Return key");
  });

  it("renders ReactNode children, not just strings", () => {
    render(
      <Kbd>
        <span data-testid="symbol">⌘</span>K
      </Kbd>,
    );
    expect(screen.getByTestId("symbol")).toBeInTheDocument();
    expect(screen.getByText("K")).toBeInTheDocument();
  });

  it("can be nested inline with surrounding text", () => {
    render(
      <p>
        Press <Kbd>Enter</Kbd> to continue.
      </p>,
    );
    const kbd = screen.getByText("Enter");
    expect(kbd.tagName).toBe("KBD");
    expect(kbd.parentElement?.tagName).toBe("P");
  });
});
