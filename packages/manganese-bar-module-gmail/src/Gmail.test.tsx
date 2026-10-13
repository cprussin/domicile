import { describe, expect, it } from "bun:test";
import { sharedWatch } from "@domicile-desktop/manganese-host/shared-watch";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { css } from "../styled-system/css";
import { Gmail } from "./Gmail";
import type { Inbox as InboxReading } from "./inbox";
import { Inbox } from "./inbox";

const EMAIL = "me@example.com";

/** A test-controlled inbox: `report` sends what the watch would. */
const heldInbox = () => {
  const listeners: ((inbox: InboxReading) => void)[] = [];
  return {
    inbox: sharedWatch((onInbox: (inbox: InboxReading) => void) => {
      listeners.push(onInbox);
      return () => undefined;
    }),
    report: (inbox: InboxReading) => {
      act(() => {
        for (const onInbox of listeners) {
          onInbox(inbox);
        }
      });
    },
  };
};

const ignoreOpen = () => undefined;

/** The item for `inbox`, opening nothing. */
const shown = (reading: InboxReading) => {
  const held = heldInbox();
  const rendered = render(
    <Gmail
      email={EMAIL}
      inbox={held.inbox}
      nickname="Work"
      onOpen={ignoreOpen}
    />,
  );
  held.report(reading);
  return rendered;
};

/** Clicks the button named `name` in an item for `inbox`; resolves with what it opened. */
const opened = (reading: InboxReading, name: string) =>
  new Promise<string>((resolve) => {
    const held = heldInbox();
    render(
      <Gmail
        email={EMAIL}
        inbox={held.inbox}
        nickname="Work"
        onOpen={resolve}
      />,
    );
    held.report(reading);
    fireEvent.click(screen.getByRole("button", { name }));
  });

const HIGHLIGHTED = css({ color: "accent" });

describe("Gmail", () => {
  it("shows nothing before the first reading", () => {
    const { container } = render(
      <Gmail
        email={EMAIL}
        inbox={heldInbox().inbox}
        nickname="Work"
        onOpen={ignoreOpen}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  describe("signed out", () => {
    it("offers to sign in", () => {
      shown(Inbox.SignedOut());

      expect(
        screen.getByRole("button", { name: "Sign in to me@example.com" }),
      ).toBeVisible();
    });

    it("opens Google's sign-in for the account", async () => {
      const url = new URL(
        await opened(Inbox.SignedOut(), "Sign in to me@example.com"),
      );

      expect(url.origin + url.pathname).toBe(
        "https://accounts.google.com/AccountChooser",
      );
      expect(url.searchParams.get("Email")).toBe(EMAIL);
      expect(url.searchParams.get("continue")).toBe(
        "https://mail.google.com/mail/u/me@example.com/",
      );
    });
  });

  describe("counted", () => {
    it("shows nothing for an empty inbox", () => {
      const { container } = shown(Inbox.Counted(0, 0));

      expect(container).toBeEmptyDOMElement();
    });

    it("shows the total, plainly, with nothing unread", () => {
      shown(Inbox.Counted(12, 0));

      const button = screen.getByRole("button", {
        name: "Work: 12 conversations",
      });
      expect(button).toHaveTextContent("Work12");
      expect(button.className).not.toContain(HIGHLIGHTED);
    });

    it("shows unread of total, highlighted, with something unread", () => {
      shown(Inbox.Counted(12, 3));

      const button = screen.getByRole("button", {
        name: "Work: 3 unread of 12 conversations",
      });
      expect(button).toHaveTextContent("Work3 / 12");
      expect(button.className).toContain(HIGHLIGHTED);
    });

    it("opens the account's inbox", async () => {
      expect(
        await opened(
          Inbox.Counted(12, 3),
          "Work: 3 unread of 12 conversations",
        ),
      ).toBe("https://mail.google.com/mail/u/me@example.com/");
    });
  });

  describe("unread only", () => {
    it("shows nothing with nothing unread", () => {
      const { container } = shown(Inbox.Unread(0));

      expect(container).toBeEmptyDOMElement();
    });

    it("shows the unread count, highlighted", () => {
      shown(Inbox.Unread(3));

      const button = screen.getByRole("button", { name: "Work: 3 unread" });
      expect(button).toHaveTextContent("Work3");
      expect(button.className).toContain(HIGHLIGHTED);
    });
  });
});
