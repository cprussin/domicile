import { describe, expect, it } from "bun:test";
import { BarContext } from "@domicile-desktop/manganese-bar/bar-context";
import { PanelKeyboardContext } from "@domicile-desktop/manganese-bar/panel-keyboard";
import { DomicileContext } from "@domicile-desktop/manganese-host/domicile-context";
import type { DomicileNotification } from "@domicile-desktop/sdk/domicile-host";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import {
  WEBVIEW_FOCUS_REQUEST_EVENT,
  WEBVIEW_PERMISSION_REQUEST_EVENT,
} from "@domicile-desktop/sdk/webview-element";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { css } from "../styled-system/css";

import { GoogleMessages } from "./bar-item";

/** Holds nothing: for tests that do not look at the keyboard. */
const ignoreKeyboard = () => () => undefined;

/** The item on a bar for each of `screens`, on one desktop. */
const onBars = (
  fake: FakeDomicileHost,
  screens: readonly string[],
  hold: () => () => void = ignoreKeyboard,
) => (
  <DomicileContext value={fake.host}>
    <PanelKeyboardContext value={hold}>
      {screens.map((name) => (
        <Bar key={name} screen={name}>
          <GoogleMessages />
        </Bar>
      ))}
    </PanelKeyboardContext>
  </DomicileContext>
);

const Bar = ({ children, screen }: { children: ReactNode; screen: string }) => (
  <div data-screen={screen}>
    <BarContext value={{ locked: false, screen }}>{children}</BarContext>
  </div>
);

/** A notification from `appName`, as the engine holds one. */
const notification = (id: number, appName: string): DomicileNotification => ({
  actions: [],
  appName,
  body: "",
  clickable: true,
  icon: "",
  id,
  summary: "New message",
  time: id,
  timeoutMs: -1,
  urgency: "normal",
});

const page = () => {
  const views = document.querySelectorAll("webview");
  expect(views).toHaveLength(1);
  return views[0] as HTMLElement;
};

describe("GoogleMessages", () => {
  it("loads Messages in the user's storage before it is opened, hidden", () => {
    // The engine denies notifications to a page in a partition.
    render(onBars(new FakeDomicileHost(), ["left"]));

    expect(page()).toHaveAttribute("src", "https://messages.google.com/web/");
    expect(page()).not.toHaveAttribute("partition");
    expect(page()).not.toBeVisible();
  });

  it("counts Messages' notifications", () => {
    const fake = new FakeDomicileHost();
    fake.set({
      notifications: [
        notification(1, "messages.google.com"),
        notification(2, "chat.example.com"),
        notification(3, "messages.google.com"),
      ],
    });

    render(onBars(fake, ["left"]));

    expect(
      screen.getByRole("button", { name: "Messages: 2 new" }),
    ).toHaveTextContent("2");
  });

  it("is round, like the bar's other icon buttons, with or without a count", () => {
    const fake = new FakeDomicileHost();
    render(onBars(fake, ["left"]));
    const isRound = (name: string) => {
      const { className } = screen.getByRole("button", { name });
      expect(className).toContain(css({ inlineSize: 7 }));
      expect(className).toContain(css({ padding: 0 }));
    };

    isRound("Messages");
    act(() => {
      fake.set({ notifications: [notification(1, "messages.google.com")] });
    });
    isRound("Messages: 1 new");
  });

  it("shows the page when pressed, and clears Messages' notifications", async () => {
    const fake = new FakeDomicileHost();
    fake.set({
      notifications: [
        notification(1, "messages.google.com"),
        notification(2, "chat.example.com"),
      ],
    });
    render(onBars(fake, ["left"]));

    await userEvent.click(
      screen.getByRole("button", { name: "Messages: 1 new" }),
    );

    expect(page()).toBeVisible();
    expect(fake.calls).toContainEqual(["dismissNotifications", [1]]);
  });

  it("keeps the keyboard while open", async () => {
    const held = new Promise<void>((resolve) => {
      render(
        onBars(new FakeDomicileHost(), ["left"], () => {
          resolve();
          return () => undefined;
        }),
      );
    });

    await userEvent.click(screen.getByRole("button", { name: "Messages" }));

    await held;
  });

  it("draws one page for every bar, and shows it from any of them", async () => {
    render(onBars(new FakeDomicileHost(), ["left", "right"]));

    const [, right] = screen.getAllByRole("button", { name: "Messages" });
    await userEvent.click(right as HTMLElement);

    expect(page()).toBeVisible();
  });

  it("keeps a page when the bar that drew it goes", () => {
    const fake = new FakeDomicileHost();
    const { rerender } = render(onBars(fake, ["left", "right"]));

    rerender(onBars(fake, ["right"]));

    expect(page()).toBeInTheDocument();
  });

  it("shows the page when it asks to be shown, as on a press of its notification", async () => {
    render(onBars(new FakeDomicileHost(), ["left"]));

    act(() => {
      page().dispatchEvent(new Event(WEBVIEW_FOCUS_REQUEST_EVENT));
    });

    await waitFor(() => {
      expect(page()).toBeVisible();
    });
  });

  it("asks the page's permission requests above it", async () => {
    render(onBars(new FakeDomicileHost(), ["left"]));
    await userEvent.click(screen.getByRole("button", { name: "Messages" }));

    fireEvent(
      page(),
      Object.assign(
        new Event(WEBVIEW_PERMISSION_REQUEST_EVENT, { cancelable: true }),
        {
          allow: () => undefined,
          deny: () => undefined,
          dismiss: () => undefined,
          origin: "https://messages.google.com",
          permissions: ["notifications"],
        },
      ),
    );

    expect(await screen.findByText("messages.google.com")).toBeVisible();
    expect(screen.getByText("Notifications")).toBeVisible();
  });
});
