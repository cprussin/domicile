import { describe, expect, it } from "bun:test";
import { fireEvent, render, screen, within } from "@testing-library/react";

import { notification } from "./fixture";
import { NotificationDrawer } from "./NotificationDrawer";

type Asked = (readonly unknown[])[];

const drawer = (
  items: Parameters<typeof NotificationDrawer>[0]["items"],
  asked: Asked = [],
) =>
  render(
    <NotificationDrawer
      items={items}
      now={0}
      onAction={(id, key) => {
        asked.push(["action", id, key]);
      }}
      onDismiss={(ids) => {
        asked.push(["dismiss", ids]);
      }}
      onOpenChange={() => undefined}
      open
    />,
  );

describe("NotificationDrawer", () => {
  it("lists every notification, in the order it is handed them", () => {
    drawer([
      notification({ id: 2, summary: "Newer" }),
      notification({ id: 1, summary: "Older" }),
    ]);

    const rows = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Newer"),
      expect.stringContaining("Older"),
    ]);
  });

  it("clears one, or every one", () => {
    const asked: Asked = [];
    drawer(
      [
        notification({ id: 2, summary: "Newer" }),
        notification({ id: 1, summary: "Older" }),
      ],
      asked,
    );

    fireEvent.click(
      screen.getAllByRole("button", { name: "Clear" })[1] as HTMLElement,
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));

    expect(asked).toEqual([
      ["dismiss", [1]],
      ["dismiss", [2, 1]],
    ]);
  });

  it("takes a notification's action", () => {
    const asked: Asked = [];
    drawer(
      [notification({ actions: [{ key: "reply", label: "Reply" }], id: 7 })],
      asked,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reply" }));

    expect(asked).toEqual([["action", 7, "reply"]]);
  });

  it("says there is nothing, and offers nothing to clear", () => {
    drawer([]);

    expect(screen.getByText("You're all caught up")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Clear all" }),
    ).not.toBeInTheDocument();
  });
});
