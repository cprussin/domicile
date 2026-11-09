import { describe, expect, it } from "bun:test";
import {
  createHandle,
  Popover,
} from "@domicile-desktop/component-library/Popover";
import { sharedWatch } from "@domicile-desktop/react/shared-watch";
import { loadEmittedStylesheet } from "@domicile-desktop/test-support/emitted-stylesheet";
import { ChatCircleTextIcon } from "@phosphor-icons/react/dist/ssr/ChatCircleText";
import { EnvelopeSimpleIcon } from "@phosphor-icons/react/dist/ssr/EnvelopeSimple";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { notification } from "./fixture";
import { Inbox, InboxReading } from "./inbox";
import type { DrawerInboxes } from "./NotificationDrawer";
import { NotificationDrawer } from "./NotificationDrawer";
import { bellId } from "./notifications-context";
import { PauseLength } from "./pause";

type Asked = (readonly unknown[])[];

/**
 * A Work inbox read from outside, and a Chat inbox in a window; records what
 * the drawer asks of them.
 */
const inboxes = (asked: Asked = []): DrawerInboxes => ({
  inboxes: [
    Inbox.Watched({
      icon: EnvelopeSimpleIcon,
      name: "Work",
      notifiesAs: "Work",
      open: () => undefined,
      read: () => sharedWatch(() => () => undefined),
    }),
    Inbox.Window({
      appId: "chat",
      countUnread: () => () => undefined,
      icon: ChatCircleTextIcon,
      name: "Chat",
      notifiesAs: "chat.example.com",
      url: "https://chat.example.com/",
    }),
  ],
  onOpen: (index) => {
    asked.push(["open inbox", index]);
  },
  readings: [InboxReading.Counted(3, 1), undefined],
});

type DrawerProps = Parameters<typeof NotificationDrawer>[0];

/** A bell on `left`, to open under. */
const Bell = ({ handle }: { handle: DrawerProps["handle"] }) => (
  <Popover.Trigger data-bell-screen="left" handle={handle} id={bellId("left")}>
    Bell
  </Popover.Trigger>
);

/** The drawer, open under the bell on `left` unless `more` says otherwise. */
const drawer = async (
  items: DrawerProps["items"],
  asked: Asked = [],
  more: Partial<DrawerProps> = {},
) => {
  const handle = more.handle ?? createHandle();
  const view = await act(async () =>
    render(element(items, asked, { ...more, handle })),
  );
  return {
    /** Draws it again with `items`, as when some are cleared. */
    update: async (
      next: DrawerProps["items"],
      changed: Partial<DrawerProps> = {},
    ) => {
      await act(() => {
        view.rerender(element(next, asked, { ...more, ...changed, handle }));
      });
    },
  };
};

const element = (
  items: DrawerProps["items"],
  asked: Asked,
  { handle = createHandle(), ...more }: Partial<DrawerProps>,
) => (
  <>
    <Bell handle={handle} />
    <NotificationDrawer
      handle={handle}
      items={items}
      now={0}
      onAction={(id, key) => {
        asked.push(["action", id, key]);
      }}
      onClose={() => {
        asked.push(["close"]);
      }}
      onDismiss={(ids) => {
        asked.push(["dismiss", ids]);
      }}
      onOpen={(screen) => {
        asked.push(["open", screen]);
      }}
      onPause={(length) => {
        asked.push(["pause", length]);
      }}
      onReply={(id, text) => {
        asked.push(["reply", id, text]);
      }}
      onResume={() => {
        asked.push(["resume"]);
      }}
      open
      pause={undefined}
      screen="left"
      {...more}
    />
  </>
);

/** The rows still sliding out of the list. */
const leaving = () => [...document.querySelectorAll("li[data-leaving]")];

/** Ends the slide out of every row sliding out. */
const finishLeaving = () => {
  for (const row of leaving()) {
    // happy-dom's `TransitionEvent` drops `propertyName`.
    fireEvent(
      row,
      Object.assign(new Event("transitionend", { bubbles: true }), {
        propertyName: "grid-template-rows",
      }),
    );
  }
};

describe("NotificationDrawer", () => {
  it("opens under the bell pressed, and says on which screen", async () => {
    const asked: Asked = [];
    await drawer([], asked, { open: false, screen: undefined });

    fireEvent.click(screen.getByRole("button", { name: "Bell" }));

    expect(asked).toEqual([["open", "left"]]);
  });

  it("lists every notification under Recent, in the order it is handed them", async () => {
    await drawer([
      notification({ id: 2, summary: "Newer" }),
      notification({ id: 1, summary: "Older" }),
    ]);

    expect(screen.getByRole("heading", { name: "Recent" })).toBeInTheDocument();
    const rows = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Newer"),
      expect.stringContaining("Older"),
    ]);
  });

  it("clears one, or every one", async () => {
    const asked: Asked = [];
    await drawer(
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

  it("takes a notification's action, and closes for the window it raises", async () => {
    const asked: Asked = [];
    await drawer(
      [notification({ actions: [{ key: "reply", label: "Reply" }], id: 7 })],
      asked,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reply" }));

    expect(asked).toEqual([["action", 7, "reply"], ["close"]]);
  });

  it("replies to a notification", async () => {
    const asked: Asked = [];
    await drawer(
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

  it("says there is nothing, and offers nothing to clear", async () => {
    await drawer([]);

    expect(screen.getByRole("status")).toHaveTextContent(
      "You're all caught up",
    );
    expect(
      screen.queryByRole("button", { name: "Clear all" }),
    ).not.toBeInTheDocument();
  });

  it("pauses for as long as is picked from its menu", async () => {
    const asked: Asked = [];
    await drawer([], asked);

    await userEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(
      (await screen.findAllByRole("menuitem")).map((item) => item.textContent),
    ).toEqual(["For 1 hour", "Until tomorrow", "Until I resume"]);
    await userEvent.click(
      screen.getByRole("menuitem", { name: "Until tomorrow" }),
    );

    expect(asked).toEqual([["pause", PauseLength.Tomorrow]]);
  });

  it("says until when it is paused, and resumes", async () => {
    const asked: Asked = [];
    const now = new Date(2026, 10, 9, 14).getTime();
    await drawer([], asked, {
      now,
      pause: { until: new Date(2026, 10, 9, 15).getTime() },
    });

    expect(screen.getByText("Paused until 3:00 PM")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Pause" }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Resume" }));

    expect(asked).toEqual([["resume"]]);
  });

  it("lists the inboxes above the notifications", async () => {
    await drawer([notification({ id: 1, summary: "Older" })], [], {
      inboxes: inboxes(),
    });

    const [list, recent] = screen.getAllByRole("list");
    expect(
      screen.getByRole("heading", { name: "Inboxes" }),
    ).toBeInTheDocument();
    expect(list).toHaveTextContent("Work");
    expect(list).toHaveTextContent("Chat");
    expect(screen.getByRole("heading", { name: "Recent" })).toBeInTheDocument();
    expect(recent).toHaveTextContent("Older");
  });

  it("opens a pressed inbox", async () => {
    const asked: Asked = [];
    await drawer([], [], { inboxes: inboxes(asked) });

    fireEvent.click(screen.getByRole("button", { name: /^Work/v }));

    expect(asked).toContainEqual(["open inbox", 0]);
  });

  it("slides in only a notification that arrives while it is open", async () => {
    const view = await drawer([notification({ id: 1, summary: "Older" })], [], {
      open: false,
    });

    await view.update([notification({ id: 1, summary: "Older" })], {
      open: true,
    });
    expect(document.querySelectorAll("li[data-arriving]")).toHaveLength(0);
    await view.update(
      [
        notification({ id: 2, summary: "Newer" }),
        notification({ id: 1, summary: "Older" }),
      ],
      { open: true },
    );

    expect(
      [...document.querySelectorAll("li[data-arriving]")].map(
        (row) => row.textContent,
      ),
    ).toEqual([expect.stringContaining("Newer")]);
  });

  describe("clearing", () => {
    loadEmittedStylesheet(
      document,
      new URL("../styled-system/styles.css", import.meta.url),
    );

    it("slides a cleared notification out, clipped, before the rest close up", async () => {
      const view = await drawer([
        notification({ id: 2, summary: "Newer" }),
        notification({ id: 1, summary: "Older" }),
      ]);

      await view.update([notification({ id: 1, summary: "Older" })]);

      expect(leaving().map((row) => row.textContent)).toEqual([
        expect.stringContaining("Newer"),
      ]);
      expect(screen.getAllByRole("listitem")).toHaveLength(1);
      // Sliding sideways, or the last row's closing gap, would scroll the pane
      // and flash scrollbars.
      const list = globalThis.getComputedStyle(screen.getByRole("list"));
      expect([list.overflowX, list.overflowY]).toEqual(["clip", "clip"]);
      finishLeaving();
      expect(leaving()).toEqual([]);
      expect(screen.queryByText("Newer")).not.toBeInTheDocument();
    });

    it("staggers the notifications cleared together, top to bottom", async () => {
      const view = await drawer([
        notification({ id: 2, summary: "Newer" }),
        notification({ id: 1, summary: "Older" }),
      ]);

      await view.update([]);

      expect(
        leaving().map((row) =>
          (row as HTMLElement).style.getPropertyValue("--leave-order"),
        ),
      ).toEqual(["0", "1"]);
    });

    it("says it is caught up once the last has slid out", async () => {
      const view = await drawer([notification({ id: 1 })]);

      await view.update([]);
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      finishLeaving();

      expect(screen.getByRole("status")).toHaveTextContent(
        "You're all caught up",
      );
    });

    it("holds the caught-up note's height as the last leave, not shrinking first", async () => {
      const view = await drawer([
        notification({ id: 2, summary: "Newer" }),
        notification({ id: 1, summary: "Older" }),
      ]);
      const list = screen.getByRole("list");

      await view.update([notification({ id: 1, summary: "Older" })]);
      expect(globalThis.getComputedStyle(list).minBlockSize).toBe("0rem");
      await view.update([]);

      // `EmptyState`'s height, spacing 40.
      expect(globalThis.getComputedStyle(list).minBlockSize).toBe("10rem");
    });

    it("drops a notification cleared while it is closed at once", async () => {
      const view = await drawer(
        [notification({ id: 2, summary: "Newer" }), notification({ id: 1 })],
        [],
        { inboxes: inboxes(), open: false },
      );

      await view.update([notification({ id: 1 })]);

      expect(leaving()).toEqual([]);
      expect(screen.queryByText("Newer")).not.toBeInTheDocument();
    });
  });
});
