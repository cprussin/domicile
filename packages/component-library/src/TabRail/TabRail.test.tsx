import { describe, expect, it } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { TabRailTab } from "./TabRail";
import { TabRail } from "./TabRail";

const TABS: TabRailTab[] = [
  { id: "a", label: "First" },
  { id: "b", label: "Second" },
];

const noop = () => undefined;

// Presentational rail: it reports actions through callbacks and holds no state
// beyond the drag affordance, so these drive props directly and assert callbacks.
const renderRail = (over: Partial<Parameters<typeof TabRail>[0]> = {}) =>
  render(
    <TabRail
      activeId="a"
      onClose={noop}
      onNew={noop}
      onReorder={noop}
      onSelect={noop}
      tabs={TABS}
      {...over}
    />,
  );

describe("TabRail", () => {
  it("lists a button per tab, in order, marking the active one", () => {
    renderRail({ activeId: "a" });
    const tabs = screen.getAllByRole("button", { name: /^(First|Second)$/ });
    expect(tabs.map((el) => el.textContent)).toEqual(["First", "Second"]);
    expect(screen.getByRole("button", { name: "First" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("button", { name: "Second" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("frames the brand, the new-tab button, and the footer", () => {
    renderRail({ brand: <span>Brand</span>, footer: <span>Footer</span> });
    expect(screen.getByText("Brand")).toBeInTheDocument();
    expect(screen.getByText("Footer")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New tab" })).toBeInTheDocument();
  });

  it("shows a close button per tab, and hides it for a tab marked not closable", () => {
    renderRail();
    expect(
      screen.getByRole("button", { name: "Close First" }),
    ).toBeInTheDocument();

    renderRail({ tabs: [{ closable: false, id: "c", label: "Pinned" }] });
    expect(screen.getByRole("button", { name: "Pinned" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Close Pinned" }),
    ).not.toBeInTheDocument();
  });

  it("selects a tab by its id when clicked", async () => {
    const selected = new Promise<string>((resolve) => {
      renderRail({ onSelect: resolve });
    });
    await userEvent.click(screen.getByRole("button", { name: "Second" }));
    expect(await selected).toBe("b");
  });

  it("closes a tab by its id from its close button", async () => {
    const closed = new Promise<string>((resolve) => {
      renderRail({ onClose: resolve });
    });
    await userEvent.click(screen.getByRole("button", { name: "Close First" }));
    expect(await closed).toBe("a");
  });

  it("reorders a tab by its id when it is dragged onto another", async () => {
    const dataTransfer = {
      dropEffect: "",
      effectAllowed: "",
      getData: () => "",
      setData: () => undefined,
    };
    const rowOf = (name: string) => {
      const row = screen.getByRole("button", { name }).closest("li");
      if (row === null) {
        throw new Error(`no row for ${name}`);
      }
      return row;
    };
    const move = await new Promise<[string, string, string]>((resolve) => {
      renderRail({
        onReorder: (from, to, position) => {
          resolve([from, to, position]);
        },
      });
      // Drag "First" and hover the lower half of "Second" — dropping after it.
      fireEvent.dragStart(rowOf("First"), { dataTransfer });
      fireEvent.dragOver(rowOf("Second"), { clientY: 10, dataTransfer });
    });
    expect(move).toEqual(["a", "b", "after"]);
  });

  it("switches to the next tab with Alt+ArrowDown, moving focus", async () => {
    const selected = new Promise<string>((resolve) => {
      renderRail({ onSelect: resolve });
      const first = screen.getByRole("button", { name: "First" });
      first.focus();
      fireEvent.keyDown(first, { altKey: true, key: "ArrowDown" });
    });
    expect(await selected).toBe("b");
    expect(screen.getByRole("button", { name: "Second" })).toHaveFocus();
  });

  it("switches to the previous tab with Alt+ArrowUp", async () => {
    const selected = new Promise<string>((resolve) => {
      renderRail({ onSelect: resolve });
      fireEvent.keyDown(screen.getByRole("button", { name: "Second" }), {
        altKey: true,
        key: "ArrowUp",
      });
    });
    expect(await selected).toBe("a");
  });

  it("rearranges a focused tab down with Alt+Shift+ArrowDown", async () => {
    const move = await new Promise<[string, string, string]>((resolve) => {
      renderRail({
        onReorder: (from, to, position) => {
          resolve([from, to, position]);
        },
      });
      fireEvent.keyDown(screen.getByRole("button", { name: "First" }), {
        altKey: true,
        key: "ArrowDown",
        shiftKey: true,
      });
    });
    expect(move).toEqual(["a", "b", "after"]);
  });

  it("rearranges a focused tab up with Alt+Shift+ArrowUp", async () => {
    const move = await new Promise<[string, string, string]>((resolve) => {
      renderRail({
        onReorder: (from, to, position) => {
          resolve([from, to, position]);
        },
      });
      fireEvent.keyDown(screen.getByRole("button", { name: "Second" }), {
        altKey: true,
        key: "ArrowUp",
        shiftKey: true,
      });
    });
    expect(move).toEqual(["b", "a", "before"]);
  });

  it("ignores Alt+Arrow at the list boundary", () => {
    let acted = false;
    const mark = () => {
      acted = true;
    };
    renderRail({ onReorder: mark, onSelect: mark });
    fireEvent.keyDown(screen.getByRole("button", { name: "First" }), {
      altKey: true,
      key: "ArrowUp",
    });
    expect(acted).toBe(false);
  });

  it("opens a new tab from the new-tab button", async () => {
    const opened = new Promise<void>((resolve) => {
      renderRail({ onNew: resolve });
    });
    await userEvent.click(screen.getByRole("button", { name: "New tab" }));
    await opened;
  });
});
