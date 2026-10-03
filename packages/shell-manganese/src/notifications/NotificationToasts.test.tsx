import { describe, expect, it } from "bun:test";
import { createToastManager } from "@domicile-desktop/component-library/Toaster";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { notification } from "./fixture";
import { NotificationToasts } from "./NotificationToasts";

describe("NotificationToasts", () => {
  it("draws each notification it is handed as a card, and presses it", async () => {
    const manager = createToastManager();
    const pressed: (readonly unknown[])[] = [];
    render(
      <NotificationToasts
        manager={manager}
        now={0}
        onAction={(id, key) => {
          pressed.push([id, key]);
        }}
        shown
      />,
    );
    const arrived = notification({
      body: "Ada: lunch?",
      clickable: true,
      id: 7,
      summary: "New message",
    });

    act(() => {
      manager.add({
        data: arrived,
        description: arrived.body,
        id: "7",
        title: arrived.summary,
      });
    });

    fireEvent.click(await screen.findByRole("button", { name: "New message" }));
    expect(screen.getByText("Ada: lunch?")).toBeVisible();
    expect(pressed).toEqual([[7, "default"]]);
  });

  it("draws nothing while it is not to be shown", () => {
    const manager = createToastManager();
    render(
      <NotificationToasts
        manager={manager}
        now={0}
        onAction={() => undefined}
        shown={false}
      />,
    );

    act(() => {
      manager.add({ data: notification({}), id: "1", title: "Hidden" });
    });

    expect(screen.queryByText("Hidden")).not.toBeInTheDocument();
  });
});
