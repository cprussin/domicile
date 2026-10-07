import { describe, expect, it } from "bun:test";
import type { PortalHost } from "@domicile-desktop/sdk/portal";
import { fakeSystem } from "@domicile-desktop/system-apps/fake-system";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Sharing } from "./Sharing";

// Created outside render, since a new system reads again.
const SYSTEM = fakeSystem(
  {
    "/share/applications/us.zoom.Zoom.desktop":
      "[Desktop Entry]\nType=Application\nName=Zoom\nExec=zoom\nIcon=zoom\n",
    "/share/icons/hicolor/scalable/apps/zoom.svg": "<svg/>",
  },
  () => ({ code: 0, stderr: "", stdout: "XDG_DATA_DIRS=/share\0" }),
);

/** A desktop that pushes `portal_requests` lines and records answers. */
class FakeHost implements PortalHost {
  readonly answers: [id: number, answer: unknown][] = [];
  readonly #listeners = new Set<(event: MessageEvent<string>) => void>();

  answerPortalRequest(id: number, answer: string): void {
    this.answers.push([id, JSON.parse(answer)]);
  }

  addEventListener(
    _type: "portalrequests",
    listener: (event: MessageEvent<string>) => void,
  ): void {
    this.#listeners.add(listener);
  }

  removeEventListener(
    _type: "portalrequests",
    listener: (event: MessageEvent<string>) => void,
  ): void {
    this.#listeners.delete(listener);
  }

  capture(capturing: readonly object[]): void {
    const data = JSON.stringify({
      capturing,
      items: [],
      type: "portal_requests",
    });
    act(() => {
      for (const listener of this.#listeners) {
        listener(new MessageEvent("portalrequests", { data }));
      }
    });
  }
}

const ZOOM = {
  app_id: "us.zoom.Zoom",
  body: {
    sources: [
      { id: "app-3", title: "Notes", type: "window" },
      { id: "app-4", title: "", type: "window" },
      { name: "drm-1", type: "monitor" },
      { position: [0, 0], size: [10, 10], type: "region" },
    ],
  },
  id: 5,
  kind: "screen_cast",
};

const REMOTE = {
  app_id: "org.example.Remote",
  body: {
    clipboard: false,
    devices: { keyboard: true, pointer: true, touchscreen: false },
  },
  id: 6,
  kind: "remote_desktop",
};

describe("Sharing", () => {
  it("shows nothing while nothing records the desktop", () => {
    const host = new FakeHost();
    render(<Sharing host={host} system={SYSTEM} />);
    host.capture([]);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("leaves sessions that only take input to the dialogs' indicator", () => {
    const host = new FakeHost();
    render(<Sharing host={host} system={SYSTEM} />);
    host.capture([REMOTE]);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("says who is recording, by the application's desktop entry", async () => {
    const host = new FakeHost();
    render(<Sharing host={host} system={SYSTEM} />);
    host.capture([ZOOM]);

    expect(
      await screen.findByRole("button", { name: "Zoom is sharing" }),
    ).toBeInTheDocument();
  });

  it("lists what each application records, and stops it", async () => {
    const host = new FakeHost();
    render(<Sharing host={host} system={SYSTEM} />);
    host.capture([ZOOM]);
    await userEvent.click(
      await screen.findByRole("button", { name: "Zoom is sharing" }),
    );

    expect(await screen.findByText("Notes")).toBeInTheDocument();
    expect(
      within(screen.getByText("Zoom")).getByRole("presentation"),
    ).toHaveAttribute("src", "data:image/svg+xml;base64,PHN2Zy8+");
    expect(screen.getByText("Untitled window")).toBeInTheDocument();
    expect(screen.getByText("Screen drm-1")).toBeInTheDocument();
    expect(screen.getByText("Region")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Stop sharing" }));

    expect(host.answers).toEqual([[5, { kind: "stop" }]]);
  });

  it("goes away when the capture ends", () => {
    const host = new FakeHost();
    render(<Sharing host={host} system={SYSTEM} />);
    host.capture([ZOOM]);
    host.capture([]);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
