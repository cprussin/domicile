import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { TabItem } from "./Tabs";
import { Tabs } from "./Tabs";

const first: TabItem = {
  content: <p>alpha content</p>,
  label: "First",
  value: "a",
};
const second: TabItem = {
  content: <p>beta content</p>,
  label: "Second",
  value: "b",
};
const items = [first, second];

describe("Tabs", () => {
  it("renders a tab per item and shows the default tab's panel", () => {
    render(<Tabs defaultValue="a" tabs={items} />);
    expect(screen.getByRole("tab", { name: "First" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Second" })).toBeInTheDocument();
    expect(screen.getByText("alpha content")).toBeInTheDocument();
    // Inactive panels unmount, so their content is absent, not just hidden.
    expect(screen.queryByText("beta content")).not.toBeInTheDocument();
  });

  it("switches panels when a tab is clicked", async () => {
    render(<Tabs defaultValue="a" tabs={items} />);
    await userEvent.click(screen.getByRole("tab", { name: "Second" }));
    expect(screen.getByText("beta content")).toBeInTheDocument();
    expect(screen.queryByText("alpha content")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Second" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("moves between tabs with the arrow keys (base-ui roving focus)", async () => {
    render(<Tabs defaultValue="a" tabs={items} />);
    await userEvent.click(screen.getByRole("tab", { name: "First" }));
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Second" })).toHaveFocus();
  });

  it("reports the active value through onValueChange", async () => {
    let seen: string | undefined;
    render(
      <Tabs
        defaultValue="a"
        onValueChange={(value) => {
          seen = value;
        }}
        tabs={items}
      />,
    );
    await userEvent.click(screen.getByRole("tab", { name: "Second" }));
    expect(seen).toBe("b");
  });

  it("does not activate a disabled tab", async () => {
    render(
      <Tabs defaultValue="a" tabs={[first, { ...second, disabled: true }]} />,
    );
    await userEvent.click(screen.getByRole("tab", { name: "Second" }));
    expect(screen.getByText("alpha content")).toBeInTheDocument();
    expect(screen.queryByText("beta content")).not.toBeInTheDocument();
  });

  it("applies a different tab-bar style per size", () => {
    const { rerender } = render(
      <Tabs defaultValue="a" size="sm" tabs={items} />,
    );
    const small = screen.getByRole("tab", { name: "First" }).className;
    rerender(<Tabs defaultValue="a" size="lg" tabs={items} />);
    const large = screen.getByRole("tab", { name: "First" }).className;
    expect(small).not.toBe(large);
  });
});
