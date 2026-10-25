import { describe, expect, it } from "bun:test";
import type { PortalHost } from "@domicile-desktop/sdk/portal";
import { fakeDesktop } from "@domicile-desktop/system-apps/fake-desktop";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Sharing } from "./Sharing";

// Created outside render, since a new domicile reads again.
const DOMICILE = fakeDesktop(
  {
    "/share/applications/org.gnome.TextEditor.desktop":
      "[Desktop Entry]\nType=Application\nName=Text Editor\nExec=te\n",
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
      {
        app_id: "org.gnome.TextEditor",
        id: "app-3",
        title: "Notes",
        type: "window",
      },
      { app_id: "", id: "app-4", title: "", type: "window" },
      { id: "7", title: "Meet", type: "browser_window" },
      { description: "Dell Inc. DELL U2720Q", name: "DP-1", type: "monitor" },
      { description: "", name: "drm-2", type: "monitor" },
      { type: "desk" },
      {
        monitor: { description: "Dell Inc. DELL U2720Q", name: "DP-1" },
        position: [0, 0],
        size: [300, 200],
        type: "region",
      },
      { position: [-500, 0], size: [10, 10], type: "region" },
    ],
  },
  id: 5,
  kind: "screen_cast",
};

/** Zoom sharing `sources` alone. */
const zoomSharing = (...sources: object[]) => ({
  ...ZOOM,
  body: { sources },
});

const DELL = {
  description: "Dell Inc. DELL U2720Q",
  name: "DP-1",
  type: "monitor",
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
    render(<Sharing domicile={DOMICILE} host={host} />);
    host.capture([]);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("leaves sessions that only take input to the dialogs' indicator", () => {
    const host = new FakeHost();
    render(<Sharing domicile={DOMICILE} host={host} />);
    host.capture([REMOTE]);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  describe("the bar button", () => {
    it("names what is shared and who shares it", async () => {
      const host = new FakeHost();
      render(<Sharing domicile={DOMICILE} host={host} />);
      host.capture([zoomSharing(DELL)]);

      const button = await screen.findByRole("button", {
        name: "Sharing screen",
      });
      expect(button).toHaveTextContent("Sharing screen");
      expect(button).toHaveAttribute("title", "Shared with Zoom");
    });

    it("names a region over every screen as all of them", async () => {
      const host = new FakeHost();
      render(<Sharing domicile={DOMICILE} host={host} />);
      host.capture([zoomSharing({ type: "desk" })]);

      expect(
        await screen.findByRole("button", { name: "Sharing all screens" }),
      ).toBeInTheDocument();
    });

    it("counts several sources of a kind", async () => {
      const host = new FakeHost();
      render(<Sharing domicile={DOMICILE} host={host} />);
      host.capture([
        zoomSharing(
          { app_id: "", id: "app-3", title: "", type: "window" },
          { id: "7", title: "Meet", type: "browser_window" },
        ),
      ]);

      expect(
        await screen.findByRole("button", { name: "Sharing 2 windows" }),
      ).toBeInTheDocument();
    });

    it("counts sources of mixed kinds across applications", async () => {
      const host = new FakeHost();
      render(<Sharing domicile={DOMICILE} host={host} />);
      host.capture([
        zoomSharing(DELL),
        {
          ...zoomSharing({ position: [0, 0], size: [10, 10], type: "region" }),
          app_id: "org.example.Meet",
          id: 6,
        },
      ]);

      const button = await screen.findByRole("button", {
        name: "Sharing 2 things",
      });
      expect(button).toHaveAttribute("title", "Shared with Zoom and Meet");
    });
  });

  describe("the panel", () => {
    it("names each source and how much of it is shared", async () => {
      const host = new FakeHost();
      render(<Sharing domicile={DOMICILE} host={host} />);
      host.capture([ZOOM]);
      await userEvent.click(
        await screen.findByRole("button", { name: "Sharing 8 things" }),
      );

      const list = await screen.findByRole("list", { name: "Shared by Zoom" });
      expect(
        within(list)
          .getAllByRole("listitem")
          .map((item) => item.textContent),
      ).toEqual([
        "NotesText Editor",
        "Untitled windowWindow",
        "MeetBrowser window",
        "Dell Inc. DELL U2720QWhole screen · DP-1",
        "Screen drm-2Whole screen",
        "All screensEvery screen",
        "Part of Dell Inc. DELL U2720Q300 × 200",
        "Part of the desktop10 × 10",
      ]);
    });

    it("shows the sharing application's icon", async () => {
      const host = new FakeHost();
      render(<Sharing domicile={DOMICILE} host={host} />);
      host.capture([zoomSharing(DELL)]);
      await userEvent.click(
        await screen.findByRole("button", { name: "Sharing screen" }),
      );

      expect(
        within(await screen.findByText("Zoom")).getByRole("presentation"),
      ).toHaveAttribute("src", "data:image/svg+xml;base64,PHN2Zy8+");
    });

    it("stops an application sharing", async () => {
      const host = new FakeHost();
      render(<Sharing domicile={DOMICILE} host={host} />);
      host.capture([zoomSharing(DELL)]);
      await userEvent.click(
        await screen.findByRole("button", { name: "Sharing screen" }),
      );
      await userEvent.click(
        await screen.findByRole("button", { name: "Stop sharing" }),
      );

      expect(host.answers).toEqual([[5, { kind: "stop" }]]);
    });
  });

  it("goes away when the capture ends", () => {
    const host = new FakeHost();
    render(<Sharing domicile={DOMICILE} host={host} />);
    host.capture([ZOOM]);
    host.capture([]);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
