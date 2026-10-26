import { describe, expect, it } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { NotificationBell } from "./NotificationBell";

describe("NotificationBell", () => {
  it("is the notifications, and opens them", () => {
    let opened = 0;
    render(
      <NotificationBell
        onOpen={() => {
          opened += 1;
        }}
        unread={0}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));

    expect(opened).toBe(1);
  });

  it("says how many arrived since they were last opened", async () => {
    render(<NotificationBell onOpen={() => undefined} unread={3} />);

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

  it("stops counting where a badge has room", () => {
    render(<NotificationBell onOpen={() => undefined} unread={42} />);

    expect(
      screen.getByRole("button", { name: "Notifications, 42 unread" }),
    ).toHaveTextContent("9+");
  });
});
