import { describe, expect, it } from "bun:test";
import {
  createHandle,
  Popover,
} from "@domicile-desktop/component-library/Popover";
import { screenOfBell } from "@domicile-desktop/manganese-notifications/notifications-context";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { NotificationBell } from "./NotificationBell";

/** A bell on `left` with `unread`, and the drawer it opens. */
const bell = (unread: number, opened: string[] = [], doNotDisturb = false) => {
  const handle = createHandle();
  return render(
    <>
      <NotificationBell
        doNotDisturb={doNotDisturb}
        handle={handle}
        screen="left"
        unread={unread}
      />
      <Popover
        handle={handle}
        onOpenChange={(open, { trigger }) => {
          if (open) {
            opened.push(screenOfBell(trigger));
          }
        }}
      >
        Drawer
      </Popover>
    </>,
  );
};

describe("NotificationBell", () => {
  it("is the notifications, and opens them under itself", async () => {
    const opened: string[] = [];
    bell(0, opened);

    await userEvent.click(
      screen.getByRole("button", { name: "Notifications" }),
    );

    expect(await screen.findByText("Drawer")).toBeVisible();
    expect(opened).toEqual(["left"]);
  });

  it("says how many arrived since they were last opened", async () => {
    bell(3);

    expect(
      screen.getByRole("button", { name: "Notifications, 3 unread" }),
    ).toHaveTextContent("3");
    await userEvent.hover(
      screen.getByRole("button", { name: "Notifications, 3 unread" }),
    );
    expect(
      await screen.findByRole("tooltip", {}, { timeout: 2000 }),
    ).toHaveTextContent("Notifications, 3 unread");
  });

  it("says while do not disturb is on", () => {
    bell(3, [], true);

    expect(
      screen.getByRole("button", {
        name: "Notifications, 3 unread, do not disturb",
      }),
    ).toBeInTheDocument();
  });

  it("strikes the bell through while do not disturb is on", () => {
    const { container } = bell(3, [], true);

    expect(container.querySelector("svg")).toHaveAttribute("data-slashed");
  });

  it("stops counting where a badge has room", () => {
    bell(42);

    expect(
      screen.getByRole("button", { name: "Notifications, 42 unread" }),
    ).toHaveTextContent("9+");
  });

  it("swings when a notification arrives, not when they are read", () => {
    const handle = createHandle();
    const { container, rerender } = render(
      <NotificationBell
        doNotDisturb={false}
        handle={handle}
        screen="left"
        unread={1}
      />,
    );
    rerender(
      <NotificationBell
        doNotDisturb={false}
        handle={handle}
        screen="left"
        unread={2}
      />,
    );
    expect(
      container.querySelector("[data-part=clapper] [data-cued]"),
    ).not.toBeNull();

    const read = render(
      <NotificationBell
        doNotDisturb={false}
        handle={handle}
        screen="right"
        unread={2}
      />,
    );
    read.rerender(
      <NotificationBell
        doNotDisturb={false}
        handle={handle}
        screen="right"
        unread={0}
      />,
    );
    expect(read.container.querySelector("[data-cued]")).toBeNull();
  });
});
