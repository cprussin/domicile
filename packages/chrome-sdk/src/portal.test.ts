import { describe, expect, it } from "bun:test";
import type {
  BoundShortcut,
  Capturing,
  PortalHost,
  PortalRequest,
  PortalWallpaper,
} from "./portal";
import {
  answerPortalRequest,
  Captured,
  CapturingKind,
  CastSource,
  ColorMode,
  FileChooserMode,
  Inhibited,
  LauncherType,
  Orientation,
  PortalAnswer,
  PortalKind,
  PrintQuality,
  Sides,
  stopCapturing,
  WallpaperTarget,
  watchBoundShortcuts,
  watchCapturing,
  watchPortalRequests,
  watchPortalWallpaper,
} from "./portal";

/** A desktop that pushes `portal_requests` lines and records answers. */
class FakeHost implements PortalHost {
  readonly answers: [id: number, answer: unknown][] = [];
  readonly #listeners = new Set<(event: MessageEvent<string>) => void>();

  answerPortalRequest(id: number, answer: string): void {
    this.answers.push([id, JSON.parse(answer)]);
  }

  addEventListener(
    type: "portalrequests",
    listener: (event: MessageEvent<string>) => void,
  ): void {
    expect(type).toBe("portalrequests");
    this.#listeners.add(listener);
  }

  removeEventListener(
    type: "portalrequests",
    listener: (event: MessageEvent<string>) => void,
  ): void {
    expect(type).toBe("portalrequests");
    this.#listeners.delete(listener);
  }

  push(
    items: readonly object[],
    capturing?: readonly object[],
    shortcuts?: readonly object[],
    wallpaper?: object,
  ): void {
    const data = JSON.stringify({
      capturing,
      items,
      shortcuts,
      type: "portal_requests",
      wallpaper,
    });
    for (const listener of this.#listeners) {
      listener(new MessageEvent("portalrequests", { data }));
    }
  }
}

const watched = (host: FakeHost): Promise<readonly PortalRequest[]> =>
  new Promise((resolve) => {
    watchPortalRequests(host, resolve);
  });

describe("watchPortalRequests", () => {
  it("parses an access request's body", async () => {
    const host = new FakeHost();
    const requests = watched(host);
    host.push([
      {
        app_id: "org.example.App",
        body: {
          body: "",
          grant_label: "Allow",
          subtitle: "Example wants to see you",
          title: "Use the camera?",
        },
        id: 1,
        kind: "access",
        parent_app_id: "app-3",
      },
    ]);

    expect(await requests).toEqual([
      {
        appId: "org.example.App",
        body: {
          body: "",
          denyLabel: undefined,
          grantLabel: "Allow",
          subtitle: "Example wants to see you",
          title: "Use the camera?",
        },
        id: 1,
        kind: PortalKind.Access,
        parentAppId: "app-3",
      },
    ]);
  });

  it("parses an app chooser's body, absent fields as undefined", async () => {
    const host = new FakeHost();
    const requests = watched(host);
    host.push([
      {
        app_id: "org.example.App",
        body: {
          choices: ["org.gnome.Evince", "firefox"],
          content_type: "application/pdf",
          filename: "report.pdf",
        },
        id: 4,
        kind: "app_chooser",
      },
    ]);

    expect(await requests).toEqual([
      {
        appId: "org.example.App",
        body: {
          choices: ["org.gnome.Evince", "firefox"],
          contentType: "application/pdf",
          filename: "report.pdf",
          lastChoice: undefined,
          uri: undefined,
        },
        id: 4,
        kind: PortalKind.AppChooser,
        parentAppId: undefined,
      },
    ]);
  });

  it("parses a file chooser's body", async () => {
    const host = new FakeHost();
    const requests = watched(host);
    host.push([
      {
        app_id: "org.example.Editor",
        body: {
          choices: [
            {
              id: "encoding",
              initial: "utf8",
              label: "Encoding",
              options: [{ id: "utf8", label: "UTF-8" }],
            },
          ],
          current_filter: 0,
          current_folder: "/home/me",
          current_name: "notes.txt",
          directory: false,
          files: [],
          filters: [{ extensions: ["txt"], name: "Text" }],
          home: "/home/me",
          mode: "save",
          multiple: false,
          title: "Save As",
        },
        id: 4,
        kind: "file_chooser",
      },
    ]);

    expect(await requests).toEqual([
      {
        appId: "org.example.Editor",
        body: {
          acceptLabel: undefined,
          choices: [
            {
              id: "encoding",
              initial: "utf8",
              label: "Encoding",
              options: [{ id: "utf8", label: "UTF-8" }],
            },
          ],
          currentFilter: 0,
          currentFolder: "/home/me",
          currentName: "notes.txt",
          directory: false,
          files: [],
          filters: [{ extensions: ["txt"], name: "Text" }],
          home: "/home/me",
          mode: FileChooserMode.Save,
          multiple: false,
          title: "Save As",
        },
        id: 4,
        kind: PortalKind.FileChooser,
        parentAppId: undefined,
      },
    ]);
  });

  it("parses an inhibitor's body", async () => {
    const host = new FakeHost();
    const requests = watched(host);
    host.push([
      {
        app_id: "org.example.Editor",
        body: { reason: "Unsaved changes", what: ["logout", "suspend"] },
        id: 5,
        kind: "inhibit",
      },
      {
        app_id: "org.example.Burner",
        body: { what: ["user_switch"] },
        id: 6,
        kind: "inhibit",
      },
    ]);

    expect(await requests).toEqual([
      {
        appId: "org.example.Editor",
        body: {
          reason: "Unsaved changes",
          what: [Inhibited.Logout, Inhibited.Suspend],
        },
        id: 5,
        kind: PortalKind.Inhibit,
        parentAppId: undefined,
      },
      {
        appId: "org.example.Burner",
        body: { reason: undefined, what: [Inhibited.UserSwitch] },
        id: 6,
        kind: PortalKind.Inhibit,
        parentAppId: undefined,
      },
    ]);
  });

  it("parses a remote desktop request's body", async () => {
    const host = new FakeHost();
    const requests = watched(host);
    host.push([
      {
        app_id: "org.example.Remote",
        body: { clipboard: true, devices: KEYBOARD_AND_POINTER },
        id: 3,
        kind: "remote_desktop",
      },
    ]);

    expect(await requests).toEqual([
      {
        appId: "org.example.Remote",
        body: {
          clipboard: true,
          devices: { keyboard: true, pointer: true, touchscreen: false },
        },
        id: 3,
        kind: PortalKind.RemoteDesktop,
        parentAppId: undefined,
      },
    ]);
  });

  it("parses an input capture request's body", async () => {
    const host = new FakeHost();
    const requests = watched(host);
    host.push([
      {
        app_id: "org.example.Barrier",
        body: { devices: KEYBOARD_AND_POINTER },
        id: 4,
        kind: "input_capture",
      },
    ]);

    expect(await requests).toEqual([
      {
        appId: "org.example.Barrier",
        body: {
          devices: { keyboard: true, pointer: true, touchscreen: false },
        },
        id: 4,
        kind: PortalKind.InputCapture,
        parentAppId: undefined,
      },
    ]);
  });

  it("parses an account request, with or without a reason", async () => {
    const host = new FakeHost();
    const requests = watched(host);
    host.push([
      {
        app_id: "org.example.Mail",
        body: { reason: "To sign you in" },
        id: 1,
        kind: "account",
      },
      { app_id: "", body: {}, id: 2, kind: "account" },
    ]);

    expect(await requests).toEqual([
      {
        appId: "org.example.Mail",
        body: { reason: "To sign you in" },
        id: 1,
        kind: PortalKind.Account,
        parentAppId: undefined,
      },
      {
        appId: "",
        body: { reason: undefined },
        id: 2,
        kind: PortalKind.Account,
        parentAppId: undefined,
      },
    ]);
  });

  it("parses a global shortcuts review's body", async () => {
    const host = new FakeHost();
    const requests = watched(host);
    host.push([
      {
        app_id: "org.example.App",
        body: {
          shortcuts: [
            { description: "Push to talk", id: "talk", trigger: "CTRL+t" },
            { description: "Mute", id: "mute" },
          ],
          taken: [{ app_id: "org.example.Other", chord: "Ctrl+Alt+m" }],
        },
        id: 4,
        kind: "global_shortcuts",
      },
    ]);

    expect(await requests).toEqual([
      {
        appId: "org.example.App",
        body: {
          shortcuts: [
            { description: "Push to talk", id: "talk", trigger: "CTRL+t" },
            { description: "Mute", id: "mute", trigger: undefined },
          ],
          taken: [{ appId: "org.example.Other", chord: "Ctrl+Alt+m" }],
        },
        id: 4,
        kind: PortalKind.GlobalShortcuts,
        parentAppId: undefined,
      },
    ]);
  });

  it("parses a wallpaper preview's body", async () => {
    const host = new FakeHost();
    const requests = watched(host);
    host.push([
      {
        app_id: "org.example.Photos",
        body: { path: "/home/u/sky.jpg", set_on: "lockscreen" },
        id: 4,
        kind: "wallpaper",
      },
    ]);

    expect(await requests).toEqual([
      {
        appId: "org.example.Photos",
        body: { path: "/home/u/sky.jpg", setOn: WallpaperTarget.Lockscreen },
        id: 4,
        kind: PortalKind.Wallpaper,
        parentAppId: undefined,
      },
    ]);
  });

  it("parses a launcher install's body", async () => {
    const host = new FakeHost();
    const requests = watched(host);
    host.push([
      {
        app_id: "org.example.Browser",
        body: {
          editable_name: true,
          icon: "data:image/png;base64,iVBORw==",
          launcher_type: "webapp",
          name: "Mail",
          target: "https://mail.example.com",
        },
        id: 7,
        kind: "dynamic_launcher",
      },
    ]);

    expect(await requests).toEqual([
      {
        appId: "org.example.Browser",
        body: {
          editableName: true,
          icon: "data:image/png;base64,iVBORw==",
          launcherType: LauncherType.Webapp,
          name: "Mail",
          target: "https://mail.example.com",
        },
        id: 7,
        kind: PortalKind.DynamicLauncher,
        parentAppId: undefined,
      },
    ]);
  });

  it("parses a screen cast request's sources", async () => {
    const host = new FakeHost();
    const requests = watched(host);
    host.push([
      {
        app_id: "us.zoom.Zoom",
        body: {
          multiple: true,
          sources: [
            {
              app_name: "Text Editor",
              icon: "data:image/png;base64,AA==",
              id: "app-3",
              title: "Notes",
              type: "window",
            },
            { id: "app-4", title: "", type: "window" },
          ],
        },
        id: 4,
        kind: "screen_cast",
      },
    ]);

    expect(await requests).toEqual([
      {
        appId: "us.zoom.Zoom",
        body: {
          multiple: true,
          sources: [
            CastSource.Window({
              appName: "Text Editor",
              icon: "data:image/png;base64,AA==",
              id: "app-3",
              title: "Notes",
            }),
            CastSource.Window({
              appName: undefined,
              icon: undefined,
              id: "app-4",
              title: "",
            }),
          ],
        },
        id: 4,
        kind: PortalKind.ScreenCast,
        parentAppId: undefined,
      },
    ]);
  });

  it("parses a USB grant's devices", async () => {
    const host = new FakeHost();
    const requests = watched(host);
    host.push([
      {
        app_id: "org.example.Keys",
        body: {
          devices: [
            { id: "dev-1", vendor: "Yubico.com", writable: true },
            { id: "dev-2", writable: false },
          ],
        },
        id: 8,
        kind: "usb",
      },
    ]);

    expect(await requests).toEqual([
      {
        appId: "org.example.Keys",
        body: {
          devices: [
            {
              id: "dev-1",
              product: undefined,
              vendor: "Yubico.com",
              writable: true,
            },
            {
              id: "dev-2",
              product: undefined,
              vendor: undefined,
              writable: false,
            },
          ],
        },
        id: 8,
        kind: PortalKind.Usb,
        parentAppId: undefined,
      },
    ]);
  });

  it("parses a print dialog's printers and their options", async () => {
    const host = new FakeHost();
    const requests = watched(host);
    host.push([
      {
        app_id: "org.example.Editor",
        body: {
          printer: "office",
          printers: [
            {
              color_modes: ["color", "monochrome"],
              copies_max: 99,
              description: "Office laser",
              initial: {
                color_mode: "monochrome",
                copies: 1,
                media: "iso_a4_210x297mm",
                orientation: "reverse_landscape",
                pages: [{ first: 1, last: 3 }],
                quality: "high",
                sides: "two_sided_short_edge",
              },
              media: [{ label: "A4 (210 × 297 mm)", name: "iso_a4_210x297mm" }],
              name: "office",
              orientations: ["portrait", "landscape"],
              page_ranges: true,
              qualities: ["draft", "normal"],
              sides: ["one_sided", "two_sided_long_edge"],
            },
          ],
          title: "Report",
        },
        id: 1,
        kind: "print",
      },
      {
        app_id: "",
        body: { printers: [], title: "Report" },
        id: 2,
        kind: "print",
      },
    ]);

    expect(await requests).toEqual([
      {
        appId: "org.example.Editor",
        body: {
          acceptLabel: undefined,
          printer: "office",
          printers: [
            {
              colorModes: [ColorMode.Color, ColorMode.Monochrome],
              copiesMax: 99,
              description: "Office laser",
              initial: {
                colorMode: ColorMode.Monochrome,
                copies: 1,
                media: "iso_a4_210x297mm",
                orientation: Orientation.ReverseLandscape,
                pages: [{ first: 1, last: 3 }],
                quality: PrintQuality.High,
                sides: Sides.TwoSidedShortEdge,
              },
              media: [{ label: "A4 (210 × 297 mm)", name: "iso_a4_210x297mm" }],
              name: "office",
              orientations: [Orientation.Portrait, Orientation.Landscape],
              pageRanges: true,
              qualities: [PrintQuality.Draft, PrintQuality.Normal],
              sides: [Sides.OneSided, Sides.TwoSidedLongEdge],
            },
          ],
          title: "Report",
        },
        id: 1,
        kind: PortalKind.Print,
        parentAppId: undefined,
      },
      {
        appId: "",
        body: {
          acceptLabel: undefined,
          printer: undefined,
          printers: [],
          title: "Report",
        },
        id: 2,
        kind: PortalKind.Print,
        parentAppId: undefined,
      },
    ]);
  });

  it("keeps a kind it does not know, to be refused", async () => {
    const host = new FakeHost();
    const requests = watched(host);
    host.push([{ app_id: "", body: { x: 1 }, id: 2, kind: "screenshot" }]);

    expect(await requests).toEqual([
      {
        appId: "",
        id: 2,
        kind: PortalKind.Unknown,
        parentAppId: undefined,
        wireKind: "screenshot",
      },
    ]);
  });

  it("knows no kind by an object's own property names", async () => {
    const host = new FakeHost();
    const requests = watched(host);
    host.push([{ app_id: "", body: {}, id: 2, kind: "constructor" }]);

    expect((await requests)[0]?.kind).toBe(PortalKind.Unknown);
  });

  it("throws on a known kind whose body does not parse", () => {
    const host = new FakeHost();
    watchPortalRequests(host, () => {
      /* no-op */
    });

    expect(() => {
      host.push([{ app_id: "", body: { title: 7 }, id: 3, kind: "access" }]);
    }).toThrow();
  });

  it("stops listening when the returned function is called", () => {
    const host = new FakeHost();
    const heard: (readonly PortalRequest[])[] = [];
    const stop = watchPortalRequests(host, (requests) => {
      heard.push(requests);
    });
    stop();
    host.push([]);

    expect(heard).toEqual([]);
  });
});

describe("watchCapturing", () => {
  const capturing = (host: FakeHost): Promise<readonly Capturing[]> =>
    new Promise((resolve) => {
      watchCapturing(host, resolve);
    });

  it("parses each session", async () => {
    const host = new FakeHost();
    const sessions = capturing(host);
    host.push(
      [],
      [
        {
          app_id: "org.example.Remote",
          body: { clipboard: false, devices: KEYBOARD_AND_POINTER },
          id: 5,
          kind: "remote_desktop",
        },
        {
          app_id: "org.example.Barrier",
          body: { devices: KEYBOARD_AND_POINTER },
          id: 6,
          kind: "input_capture",
        },
        { app_id: "", body: {}, id: 7, kind: "screenshot" },
      ],
    );

    expect(await sessions).toEqual([
      {
        appId: "org.example.Remote",
        clipboard: false,
        devices: { keyboard: true, pointer: true, touchscreen: false },
        id: 5,
        kind: CapturingKind.RemoteDesktop,
      },
      {
        appId: "org.example.Barrier",
        devices: { keyboard: true, pointer: true, touchscreen: false },
        id: 6,
        kind: CapturingKind.InputCapture,
      },
      {
        appId: "",
        id: 7,
        kind: CapturingKind.Unknown,
        wireKind: "screenshot",
      },
    ]);
  });

  it("parses what a screen cast records", async () => {
    const host = new FakeHost();
    const sessions = new Promise<readonly Capturing[]>((resolve) => {
      watchCapturing(host, resolve);
    });
    host.push(
      [],
      [
        {
          app_id: "us.zoom.Zoom",
          body: { sources: [{ id: "app-3", title: "Notes", type: "window" }] },
          id: 5,
          kind: "screen_cast",
        },
      ],
    );

    expect(await sessions).toEqual([
      {
        appId: "us.zoom.Zoom",
        id: 5,
        kind: CapturingKind.ScreenCast,
        sources: [Captured.Window({ id: "app-3", title: "Notes" })],
      },
    ]);
  });

  it("reads a push without sessions as none", async () => {
    const host = new FakeHost();
    const sessions = capturing(host);
    host.push([]);

    expect(await sessions).toEqual([]);
  });

  it("stops listening when the returned function is called", () => {
    const host = new FakeHost();
    const heard: (readonly Capturing[])[] = [];
    const stop = watchCapturing(host, (sessions) => {
      heard.push(sessions);
    });
    stop();
    host.push([]);

    expect(heard).toEqual([]);
  });
});

describe("watchBoundShortcuts", () => {
  it("parses the chords applications hold, none when absent", async () => {
    const host = new FakeHost();
    const heard: (readonly BoundShortcut[])[] = [];
    const both = new Promise<void>((resolve) => {
      watchBoundShortcuts(host, (shortcuts) => {
        heard.push(shortcuts);
        if (heard.length === 2) {
          resolve();
        }
      });
    });
    host.push([], undefined, [
      { app_id: "org.example.App", chord: "Ctrl+Alt+t", id: 3 },
    ]);
    host.push([]);
    await both;

    expect(heard).toEqual([
      [{ appId: "org.example.App", chord: "Ctrl+Alt+t", id: 3 }],
      [],
    ]);
  });
});

describe("watchPortalWallpaper", () => {
  const wallpaper = (host: FakeHost): Promise<PortalWallpaper> =>
    new Promise((resolve) => {
      watchPortalWallpaper(host, resolve);
    });

  it("reads the pictures applications set", async () => {
    const host = new FakeHost();
    const heard = wallpaper(host);
    host.push([], undefined, undefined, {
      background: "/state/background-1.jpg",
    });

    expect(await heard).toEqual({
      background: "/state/background-1.jpg",
      lockscreen: undefined,
    });
  });

  it("reads none set when the line has no wallpaper", async () => {
    const host = new FakeHost();
    const heard = wallpaper(host);
    host.push([]);

    expect(await heard).toEqual({
      background: undefined,
      lockscreen: undefined,
    });
  });
});

describe("answerPortalRequest", () => {
  it("writes each answer as the compositor reads it", () => {
    const host = new FakeHost();
    answerPortalRequest(host, 1, PortalAnswer.Access());
    answerPortalRequest(host, 2, PortalAnswer.Canceled());
    answerPortalRequest(host, 3, PortalAnswer.Refused());
    answerPortalRequest(host, 4, PortalAnswer.AppChooser("firefox"));
    answerPortalRequest(host, 7, PortalAnswer.DynamicLauncher("Work mail"));
    answerPortalRequest(
      host,
      5,
      PortalAnswer.FileChooser({
        choices: new Map([["encoding", "utf8"]]),
        currentFilter: 1,
        paths: ["/home/me/a.txt"],
      }),
    );
    answerPortalRequest(
      host,
      6,
      PortalAnswer.FileChooser({
        choices: new Map(),
        currentFilter: undefined,
        paths: ["/home/me"],
      }),
    );

    answerPortalRequest(
      host,
      7,
      PortalAnswer.RemoteDesktop(
        { keyboard: true, pointer: false, touchscreen: false },
        true,
      ),
    );
    answerPortalRequest(host, 8, PortalAnswer.InputCapture());
    answerPortalRequest(
      host,
      9,
      PortalAnswer.GlobalShortcuts([
        { id: "talk", trigger: "Ctrl+Alt+t" },
        { id: "mute", trigger: undefined },
      ]),
    );

    expect(host.answers).toEqual([
      [1, { kind: "access" }],
      [2, { kind: "canceled" }],
      [3, { kind: "refused" }],
      [4, { choice: "firefox", kind: "app_chooser" }],
      [7, { kind: "dynamic_launcher", name: "Work mail" }],
      [
        5,
        {
          choices: { encoding: "utf8" },
          current_filter: 1,
          kind: "file_chooser",
          paths: ["/home/me/a.txt"],
        },
      ],
      [6, { choices: {}, kind: "file_chooser", paths: ["/home/me"] }],
      [
        7,
        {
          clipboard: true,
          devices: { keyboard: true, pointer: false, touchscreen: false },
          kind: "remote_desktop",
        },
      ],
      [8, { kind: "input_capture" }],
      [
        9,
        {
          kind: "global_shortcuts",
          triggers: [{ id: "talk", trigger: "Ctrl+Alt+t" }, { id: "mute" }],
        },
      ],
    ]);
  });

  it("writes the windows picked for a screen cast", () => {
    const host = new FakeHost();
    answerPortalRequest(
      host,
      4,
      PortalAnswer.ScreenCast([
        CastSource.Window({
          appName: undefined,
          icon: undefined,
          id: "app-3",
          title: "Notes",
        }),
      ]),
    );

    expect(host.answers).toEqual([
      [4, { kind: "screen_cast", sources: [{ id: "app-3", type: "window" }] }],
    ]);
  });
});

describe("answerPortalRequest for a print dialog", () => {
  it("writes the printer and options, leaving out the printer's defaults", () => {
    const host = new FakeHost();
    answerPortalRequest(
      host,
      1,
      PortalAnswer.Print("office", {
        colorMode: ColorMode.Color,
        copies: 2,
        media: "na_letter_8.5x11in",
        orientation: Orientation.Portrait,
        pages: [{ first: 2, last: 2 }],
        quality: PrintQuality.Draft,
        sides: Sides.OneSided,
      }),
    );
    answerPortalRequest(
      host,
      2,
      PortalAnswer.Print("label", {
        colorMode: undefined,
        copies: 1,
        media: undefined,
        orientation: undefined,
        pages: [],
        quality: undefined,
        sides: undefined,
      }),
    );

    expect(host.answers).toEqual([
      [
        1,
        {
          kind: "print",
          options: {
            color_mode: "color",
            copies: 2,
            media: "na_letter_8.5x11in",
            orientation: "portrait",
            pages: [{ first: 2, last: 2 }],
            quality: "draft",
            sides: "one_sided",
          },
          printer: "office",
        },
      ],
      [
        2,
        { kind: "print", options: { copies: 1, pages: [] }, printer: "label" },
      ],
    ]);
  });
});

describe("stopCapturing", () => {
  it("answers the session with a stop", () => {
    const host = new FakeHost();
    stopCapturing(host, 5);

    expect(host.answers).toEqual([[5, { kind: "stop" }]]);
  });
});

const KEYBOARD_AND_POINTER = {
  keyboard: true,
  pointer: true,
  touchscreen: false,
};
