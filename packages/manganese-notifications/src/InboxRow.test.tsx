import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { InboxRow } from "./InboxRow";

describe(InboxRow, () => {
  it("names the inbox and its counts, and opens it", async () => {
    const opened: string[] = [];
    render(
      <InboxRow
        detail="412 conversations"
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
    expect(row).toHaveTextContent("412 conversations");
    expect(screen.getByText("3")).toBeInTheDocument();
    await userEvent.click(row);

    expect(opened).toEqual(["Work"]);
  });

  it("shows a figure in place of the count when nothing is unread", () => {
    render(
      <InboxRow
        figure="Sign in"
        icon={undefined}
        label="Sign in to Work"
        name="Work"
        onOpen={() => undefined}
        unread={0}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Sign in to Work" }),
    ).toHaveTextContent("Sign in");
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
