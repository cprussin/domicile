import { describe, expect, it } from "bun:test";
import { DisplayProvider } from "@domicile-desktop/component-library/DisplayProvider";
import { createToastManager } from "@domicile-desktop/component-library/Toaster";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { OnOneScreen, SCREEN } from "../screens/fixture";
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
        screen={SCREEN}
        shown
      />,
      { wrapper: OnOneScreen },
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
        screen={SCREEN}
        shown={false}
      />,
      { wrapper: OnOneScreen },
    );

    act(() => {
      manager.add({ data: notification({}), id: "1", title: "Hidden" });
    });

    expect(screen.queryByText("Hidden")).not.toBeInTheDocument();
  });

  it("stacks on the screen it is asked for", () => {
    render(
      <DisplayProvider
        source={{
          displays: [
            { name: "left", position: [0, 0], scale: 1, size: [1920, 1080] },
            {
              name: "right",
              position: [1920, 0],
              scale: 1,
              size: [2560, 1440],
            },
          ],
          onDisplays: () => () => undefined,
        }}
      >
        <NotificationToasts
          manager={createToastManager()}
          now={0}
          onAction={() => undefined}
          screen="right"
          shown
        />
      </DisplayProvider>,
    );

    // The toaster, in the region under the bar, in the screen's box.
    const box =
      screen.getByLabelText("Notifications").parentElement?.parentElement;
    expect(box?.style.left).toBe("1920px");
    expect(box?.style.width).toBe("2560px");
  });
});
