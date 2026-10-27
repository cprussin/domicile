import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { InboxRow } from "./InboxRow";

describe(InboxRow, () => {
  it("names the inbox and its count, and opens it", async () => {
    const opened: string[] = [];
    render(
      <InboxRow
        figure="412"
        icon={undefined}
        label="Work: 3 unread of 412 conversations"
        name="Work"
        onOpen={() => {
          opened.push("Work");
        }}
        unread={3}
      />,
    );

    const row = screen.getByRole("button", {
      name: "Work: 3 unread of 412 conversations",
    });
    expect(row).toHaveTextContent("Work");
    // The unread count in its place, not the total.
    expect(row).toHaveTextContent("3");
    expect(row).not.toHaveTextContent("412");
    await userEvent.click(row);

    expect(opened).toEqual(["Work"]);
  });

  it("shows the total when nothing is unread", () => {
    render(
      <InboxRow
        figure="412"
        icon={undefined}
        label="Work: 412 conversations"
        name="Work"
        onOpen={() => undefined}
        unread={0}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Work: 412 conversations" }),
    ).toHaveTextContent("412");
  });

  it("warns when the inbox could not be read", () => {
    render(
      <InboxRow
        figure="Couldn't check"
        icon={undefined}
        label="Work: could not read the inbox: offline"
        name="Work"
        onOpen={() => undefined}
        unread={0}
        warning
      />,
    );

    expect(screen.getByRole("img", { name: "Warning" })).toBeVisible();
  });
});
