import { describe, expect, it } from "bun:test";
import { sharedWatch } from "@domicile-desktop/react/shared-watch";
import { EnvelopeSimpleIcon } from "@phosphor-icons/react/dist/ssr/EnvelopeSimple";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InboxList } from "./InboxList";
import type { InboxReading as Reading } from "./inbox";
import { Inbox, InboxReading } from "./inbox";

const WORK = Inbox.Watched({
  icon: EnvelopeSimpleIcon,
  name: "Work",
  open: () => undefined,
  read: () => sharedWatch(() => () => undefined),
});

const CHAT = Inbox.Page({
  countUnread: () => () => undefined,
  icon: EnvelopeSimpleIcon,
  name: "Chat",
  url: "https://chat.example.com/",
});

/** The list of `inboxes` read as `readings`; returns what it opened. */
const shown = (
  readings: readonly (Reading | undefined)[],
  inboxes: readonly Inbox[] = [WORK],
) => {
  const opened: number[] = [];
  render(
    <InboxList
      inboxes={inboxes}
      onOpen={(index) => {
        opened.push(index);
      }}
      readings={readings}
    />,
  );
  return opened;
};

describe(InboxList, () => {
  it("leaves out an inbox before its first reading", () => {
    shown([undefined]);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("offers to sign a signed-out inbox in", async () => {
    const opened = shown([InboxReading.SignedOut()]);

    const row = screen.getByRole("button", { name: "Sign in to Work" });
    expect(row).toHaveTextContent("Sign in");
    await userEvent.click(row);

    expect(opened).toEqual([0]);
  });

  it("says an empty inbox is empty", () => {
    shown([InboxReading.Counted(0, 0)]);

    expect(
      screen.getByRole("button", { name: "Work: empty" }),
    ).toHaveTextContent("Empty");
  });

  it("shows the total, and the unread count in words", () => {
    shown([InboxReading.Counted(12, 3)]);

    expect(
      screen.getByRole("button", {
        name: "Work: 3 unread of 12 conversations",
      }),
    ).toHaveTextContent("12");
  });

  it("names a read inbox with nothing unread by its count", () => {
    shown([InboxReading.Counted(12, 0)]);

    expect(
      screen.getByRole("button", { name: "Work: 12 conversations" }),
    ).toBeVisible();
  });

  it("warns when it could not read the inbox, naming why, and still opens it", async () => {
    const opened = shown([InboxReading.Failed("Gmail's page answered 500")]);

    const row = screen.getByRole("button", {
      name: "Work: could not read the inbox: Gmail's page answered 500",
    });
    expect(screen.getByRole("img", { name: "Warning" })).toBeVisible();
    await userEvent.click(row);

    expect(opened).toEqual([0]);
  });

  it("lists a page by its unread count alone, from before its first count", async () => {
    const opened = shown([InboxReading.Counted(1, 0), undefined], [WORK, CHAT]);

    await userEvent.click(screen.getByRole("button", { name: "Chat" }));

    expect(opened).toEqual([1]);
  });

  it("names the unread count of an inbox that knows only that", () => {
    shown([InboxReading.Unread(2)], [CHAT]);

    expect(
      screen.getByRole("button", { name: "Chat: 2 unread" }),
    ).toBeVisible();
  });
});
