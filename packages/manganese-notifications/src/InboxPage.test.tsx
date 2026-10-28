import { describe, expect, it } from "bun:test";
import {
  WEBVIEW_FOCUS_REQUEST_EVENT,
  WEBVIEW_LOADING_CHANGE_EVENT,
  WEBVIEW_PERMISSION_REQUEST_EVENT,
} from "@domicile-desktop/sdk/webview-element";
import { ChatCircleTextIcon } from "@phosphor-icons/react/dist/ssr/ChatCircleText";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { InboxPage } from "./InboxPage";
import { Inbox } from "./inbox";

/** Counts 2 unread conversations as soon as it starts. */
const CHAT = Inbox.Page({
  countUnread: (_view, onUnread) => {
    onUnread(2);
    return () => undefined;
  },
  icon: ChatCircleTextIcon,
  name: "Chat",
  url: "https://chat.example.com/",
});

/** The page, shown or not; returns what it asked of the drawer. */
const drawn = (shown: boolean) => {
  const asked: (readonly unknown[])[] = [];
  render(
    <InboxPage
      inbox={CHAT}
      onShow={() => {
        asked.push(["show"]);
      }}
      onUnread={(unread) => {
        asked.push(["unread", unread]);
      }}
      shown={shown}
    />,
  );
  return asked;
};

const page = () => {
  const views = document.querySelectorAll("webview");
  expect(views).toHaveLength(1);
  return views[0] as HTMLElement;
};

describe(InboxPage, () => {
  it("loads the page in the user's storage before it is shown, hidden", () => {
    // The engine denies notifications to a page in a partition.
    drawn(false);

    expect(page()).toHaveAttribute("src", "https://chat.example.com/");
    expect(page()).not.toHaveAttribute("partition");
    expect(page()).not.toBeVisible();
  });

  it("counts the page's unread conversations", () => {
    expect(drawn(false)).toEqual([["unread", 2]]);
  });

  it("shows the page", () => {
    drawn(true);

    expect(page()).toBeVisible();
  });

  it("says it is opening the page until it has loaded", () => {
    drawn(true);
    expect(screen.getByRole("status")).toHaveTextContent("Opening Chat…");

    act(() => {
      Object.assign(page(), { loading: false });
      page().dispatchEvent(new Event(WEBVIEW_LOADING_CHANGE_EVENT));
    });

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("asks to be shown when the page asks, as on a press of its notification", () => {
    const asked = drawn(false);

    act(() => {
      page().dispatchEvent(new Event(WEBVIEW_FOCUS_REQUEST_EVENT));
    });

    expect(asked.at(-1)).toEqual(["show"]);
  });

  it("reloads the page when the network comes back, as it may have loaded offline", () => {
    drawn(false);
    let reloads = 0;
    Object.assign(page(), {
      reload: () => {
        reloads += 1;
      },
    });

    act(() => {
      globalThis.dispatchEvent(new Event("online"));
    });

    expect(reloads).toBe(1);
  });

  it("asks the page's permission requests above it", async () => {
    drawn(true);

    fireEvent(
      page(),
      Object.assign(
        new Event(WEBVIEW_PERMISSION_REQUEST_EVENT, { cancelable: true }),
        {
          allow: () => undefined,
          deny: () => undefined,
          dismiss: () => undefined,
          origin: "https://chat.example.com",
          permissions: ["notifications"],
        },
      ),
    );

    expect(await screen.findByText("chat.example.com")).toBeVisible();
    expect(screen.getByText("Notifications")).toBeVisible();
  });
});
