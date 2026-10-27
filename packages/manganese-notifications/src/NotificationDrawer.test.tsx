import { describe, expect, it } from "bun:test";
import { sharedWatch } from "@domicile-desktop/react/shared-watch";
import { ChatCircleTextIcon } from "@phosphor-icons/react/dist/ssr/ChatCircleText";
import { EnvelopeSimpleIcon } from "@phosphor-icons/react/dist/ssr/EnvelopeSimple";
import { fireEvent, render, screen, within } from "@testing-library/react";

import { notification } from "./fixture";
import { Inbox, InboxReading } from "./inbox";
import type { DrawerInboxes } from "./NotificationDrawer";
import { NotificationDrawer } from "./NotificationDrawer";

type Asked = (readonly unknown[])[];

/**
 * A Work inbox read from outside, and a Chat page that counts 4 unread; records
 * what the drawer asks of them.
 */
const inboxes = (asked: Asked = []): DrawerInboxes => ({
  inboxes: [
    Inbox.Watched({
      icon: EnvelopeSimpleIcon,
      name: "Work",
      open: () => undefined,
      read: () => sharedWatch(() => () => undefined),
    }),
    Inbox.Page({
      countUnread: (_view, onUnread) => {
        onUnread(4);
        return () => undefined;
      },
      icon: ChatCircleTextIcon,
      name: "Chat",
      url: "https://chat.example.com/",
    }),
  ],
  onOpen: (index) => {
    asked.push(["open inbox", index]);
  },
  onShow: (index) => {
    asked.push(["show inbox", index]);
  },
  onUnread: (index, unread) => {
    asked.push(["unread", index, unread]);
  },
  readings: [InboxReading.Counted(3, 1), undefined],
  shown: undefined,
});

type DrawerProps = Parameters<typeof NotificationDrawer>[0];

const drawer = (
  items: DrawerProps["items"],
  asked: Asked = [],
  more: Partial<DrawerProps> = {},
) =>
  render(
    <NotificationDrawer
      items={items}
      now={0}
      onAction={(id, key) => {
        asked.push(["action", id, key]);
      }}
      onBack={() => {
        asked.push(["back"]);
      }}
      onDismiss={(ids) => {
        asked.push(["dismiss", ids]);
      }}
      onOpenChange={(open) => {
        asked.push(["open", open]);
      }}
      onReply={(id, text) => {
        asked.push(["reply", id, text]);
      }}
      open
      screen={undefined}
      {...more}
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

  it("takes a notification's action, and closes for the window it raises", () => {
    const asked: Asked = [];
    drawer(
      [notification({ actions: [{ key: "reply", label: "Reply" }], id: 7 })],
      asked,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reply" }));

    expect(asked).toEqual([
      ["action", 7, "reply"],
      ["open", false],
    ]);
  });

  it("replies to a notification", () => {
    const asked: Asked = [];
    drawer(
      [
        notification({
          actions: [{ key: "inline-reply", label: "Reply" }],
          id: 7,
        }),
      ],
      asked,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Reply" }), {
      target: { value: "On my way" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(asked).toEqual([["reply", 7, "On my way"]]);
  });

  it("says there is nothing, and offers nothing to clear", () => {
    drawer([]);

    expect(screen.getByText("You're all caught up")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Clear all" }),
    ).not.toBeInTheDocument();
  });

  it("lists the inboxes above the notifications", () => {
    drawer([notification({ id: 1, summary: "Older" })], [], {
      inboxes: inboxes(),
    });

    const [list, recent] = screen.getAllByRole("list");
    expect(screen.getByRole("heading", { name: "Inboxes" })).toBeVisible();
    expect(list).toHaveTextContent("Work");
    expect(list).toHaveTextContent("Chat");
    expect(screen.getByRole("heading", { name: "Recent" })).toBeVisible();
    expect(recent).toHaveTextContent("Older");
  });

  it("opens a pressed inbox", () => {
    const asked: Asked = [];
    drawer([], [], { inboxes: inboxes(asked) });

    fireEvent.click(screen.getByRole("button", { name: /^Work/v }));

    expect(asked).toContainEqual(["open inbox", 0]);
  });

  it("keeps the inboxes' pages loaded while closed", () => {
    drawer([], [], { inboxes: inboxes(), open: false });

    expect(document.querySelector("webview")).not.toBeNull();
  });

  it("hears a page's unread count, by its place", () => {
    const asked: Asked = [];
    drawer([], [], { inboxes: inboxes(asked) });

    expect(asked).toContainEqual(["unread", 1, 4]);
  });

  it("shows an inbox's page, wide, and goes back", () => {
    const asked: Asked = [];
    drawer([notification({ id: 1, summary: "Older" })], asked, {
      inboxes: { ...inboxes(asked), shown: 1 },
    });

    expect(screen.getByRole("heading", { name: "Chat" })).toBeVisible();
    expect(screen.getByRole("dialog")).toHaveAttribute("data-wide");
    expect(document.querySelector("webview")).toBeVisible();
    // Hidden, not gone, so an inbox's page keeps running.
    expect(screen.getByText("Older")).not.toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Clear all" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(asked.at(-1)).toEqual(["back"]);
  });
});
