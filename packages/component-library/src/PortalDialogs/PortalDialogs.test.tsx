import { describe, expect, it } from "bun:test";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import { SHELL_APP_ID } from "@domicile-desktop/sdk/portal";
import type { Node } from "@domicile-desktop/system-apps/fake-system";
import { fakeSystem } from "@domicile-desktop/system-apps/fake-system";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DisplayProvider } from "../Screen/DisplayProvider";
import type { DisplaySource } from "../Screen/display-source";
import { PortalDialogs } from "./PortalDialogs";

/**
 * A desktop that pushes `portal_requests` lines and records answers. Its
 * system calls go to the `fakeSystem` each test passes as `systemOf`.
 */
class FakeHost {
  readonly fake = new FakeDomicileHost();
  readonly host = this.fake.host;

  get answers(): [id: unknown, answer: unknown][] {
    return this.fake.calls
      .filter(([name]) => name === "answerPortalRequest")
      .map(([, id, answer]) => [id, JSON.parse(String(answer))]);
  }

  push(
    items: readonly object[],
    capturing?: readonly object[],
    shortcuts?: readonly object[],
  ): void {
    const data = JSON.stringify({
      capturing,
      items,
      shortcuts,
      type: "portal_requests",
    });
    act(() => {
      this.fake.dispatch("portalrequests", { data });
    });
  }
}

const access = (id: number, body: object = {}) => ({
  app_id: "org.example.App",
  body: {
    body: "It will see you.",
    subtitle: "Example wants the camera",
    title: "Use the camera?",
    ...body,
  },
  id,
  kind: "access",
});

/** An application's desktop entry. */
const entry = (name: string, icon: string): string =>
  `[Desktop Entry]\nType=Application\nName=${name}\nExec=${icon}\nIcon=${icon}\n`;

/**
 * A desktop with a document viewer and a browser installed, the browser the
 * default for PDFs, and `tree` besides.
 */
const desktop =
  (tree: Readonly<Record<string, Node>> = {}) =>
  () =>
    fakeSystem(
      {
        "/config/mimeapps.list":
          "[Default Applications]\napplication/pdf=firefox.desktop\n",
        "/share/applications/firefox.desktop": entry("Firefox", "firefox"),
        "/share/applications/org.gnome.Evince.desktop": entry(
          "Document Viewer",
          "evince",
        ),
        "/share/icons/hicolor/48x48/apps/firefox.svg": "<svg/>",
        ...tree,
      },
      () => ({
        code: 0,
        stderr: "",
        stdout:
          "XDG_CONFIG_HOME=/config\0XDG_DATA_HOME=/data\0XDG_DATA_DIRS=/share\0",
      }),
    );

const chooser = (id: number, body: object = {}) => ({
  app_id: "org.example.App",
  body: {
    choices: ["org.gnome.Evince", "firefox"],
    content_type: "application/pdf",
    filename: "report.pdf",
    ...body,
  },
  id,
  kind: "app_chooser",
});

/** A desktop with a small home for the file chooser to list. */
const home = () =>
  desktop({
    "/home/me/Documents/report.pdf": "",
    "/home/me/notes.txt": "",
    "/home/me/photo.png": "",
  });

const fileChooser = (id: number, body: object = {}) => ({
  app_id: "org.example.Editor",
  body: {
    choices: [],
    directory: false,
    files: [],
    filters: [],
    home: "/home/me",
    mode: "open",
    multiple: false,
    title: "Open Notes",
    ...body,
  },
  id,
  kind: "file_chooser",
});

/** Lets the picker's listings resolve. */
const listed = () => act(() => Promise.resolve());

/** Lets the applications' desktop entries be read. */
const named = () =>
  act(
    () =>
      new Promise((resolve) => {
        setTimeout(resolve, 0);
      }),
  );

const remoteDesktop = (id: number, clipboard: boolean) => ({
  app_id: "org.example.Remote",
  body: {
    clipboard,
    devices: { keyboard: true, pointer: true, touchscreen: false },
  },
  id,
  kind: "remote_desktop",
});

const inputCapture = (id: number) => ({
  app_id: "org.example.Barrier",
  body: { devices: { keyboard: true, pointer: true, touchscreen: false } },
  id,
  kind: "input_capture",
});

const account = (
  id: number,
  body: object = { name: "Ada Lovelace", reason: "To sign you in" },
) => ({
  app_id: "org.example.Mail",
  body,
  id,
  kind: "account",
});

const shortcuts = (id: number) => ({
  app_id: "org.example.App",
  body: {
    shortcuts: [
      { description: "Push to talk", id: "talk", trigger: "CTRL+ALT+t" },
      { description: "Mute", id: "mute" },
      { description: "Deafen", id: "deafen", trigger: "Alt+Meta+d" },
    ],
    taken: [{ app_id: "org.example.Other", chord: "Ctrl+Alt+t" }],
  },
  id,
  kind: "global_shortcuts",
});

const wallpaper = (id: number) => ({
  app_id: "org.example.Photos",
  body: { path: "/home/u/sky.jpg", set_on: "both" },
  id,
  kind: "wallpaper",
});

/** A desktop holding the picture `wallpaper` names. */
const withPicture = desktop({ "/home/u/sky.jpg": "sky" });
const printer = (name: string, initial: object = {}) => ({
  color_modes: ["color", "monochrome"],
  copies_max: 9,
  description: `${name} printer`,
  initial: { copies: 1, media: "iso_a4_210x297mm", pages: [], ...initial },
  media: [
    { label: "A4 (210 × 297 mm)", name: "iso_a4_210x297mm" },
    { label: "Letter (8.5 × 11 in)", name: "na_letter_8.5x11in" },
  ],
  name,
  orientations: ["portrait", "landscape"],
  page_ranges: true,
  qualities: [],
  sides: ["one_sided", "two_sided_long_edge"],
});

const print = (id: number, printers: readonly object[], start = "office") => ({
  app_id: "org.example.Editor",
  body: { accept_label: "Print it", printer: start, printers, title: "Report" },
  id,
  kind: "print",
});

const launcher = (id: number, body: object = {}) => ({
  app_id: "org.example.Browser",
  body: {
    editable_name: true,
    icon: "data:image/png;base64,iVBORw==",
    launcher_type: "webapp",
    name: "Mail",
    target: "https://mail.example.com",
    ...body,
  },
  id,
  kind: "dynamic_launcher",
});

const usb = (id: number) => ({
  app_id: "org.example.Keys",
  body: {
    devices: [
      {
        id: "dev-1",
        product: "YubiKey 5",
        vendor: "Yubico.com",
        writable: true,
      },
      { id: "dev-2", writable: false },
    ],
  },
  id,
  kind: "usb",
});

const WINDOWS = [
  { app_id: "firefox", id: "app-3", title: "Notes", type: "window" },
  { app_id: "", id: "app-4", title: "", type: "window" },
];

const MONITORS = [
  {
    description: "Dell Inc. DELL U3219Q",
    name: "drm-1",
    size: [1920, 1080],
    type: "monitor",
  },
  { description: "", name: "drm-2", size: [1280, 800], type: "monitor" },
];

const screenCast = (
  multiple = false,
  sources: readonly object[] = WINDOWS,
  region = false,
) => ({
  app_id: "us.zoom.Zoom",
  body: { multiple, region, sources },
  id: 5,
  kind: "screen_cast",
});

/**
 * A 300x100 frozen desk with one monitor and one window: the desktop from
 * (-10, 0) to (140, 50), at two frame pixels a CSS pixel.
 */
const frozen = (id: number, kind: "screenshot" | "pick_color") => ({
  app_id: "org.example.Shooter",
  body: {
    desk: { position: [-10, 0], size: [150, 50] },
    frame: "data:image/png;base64,AA==",
    height: 100,
    monitors: [{ area: { height: 100, width: 300, x: 0, y: 0 }, name: "DP-1" }],
    width: 300,
    windows: [
      {
        app_id: "kitty",
        area: { height: 40, width: 30, x: 10, y: 20 },
        title: "~/src",
      },
    ],
  },
  id,
  kind,
});

/** A `<webview>` drawing browser window `id` at `box` in the page. */
const webview = (id: string | undefined, box: DOMRectInit): HTMLElement => {
  const view = document.createElement("webview");
  if (id !== undefined) {
    view.setAttribute("window", id);
  }
  view.getBoundingClientRect = () => DOMRect.fromRect(box);
  document.body.append(view);
  return view;
};

/** Browser window `id`, titled `title`, as the engine lists it. */
const browserWindow = (id: string, title: string) => ({
  height: 0,
  id,
  isPrivate: false,
  popupWindow: null,
  title,
  url: "https://example.com",
  width: 0,
});

/** Draws `element` 150x50 at (10, 20), as layout would. */
const drawnAtHalfSize = (element: HTMLElement): HTMLElement => {
  element.getBoundingClientRect = () =>
    DOMRect.fromRect({ height: 50, width: 150, x: 10, y: 20 });
  return element;
};

describe(PortalDialogs, () => {
  describe("rendering", () => {
    it("draws nothing while no application asks", () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} />);
      host.push([]);

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("asks an access question naming the application", () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} />);
      host.push([access(1)]);

      expect(screen.getByRole("dialog")).toHaveTextContent("Use the camera?");
      expect(screen.getByText("org.example.App asks")).toBeInTheDocument();
      expect(screen.getByText("Example wants the camera")).toBeInTheDocument();
      expect(screen.getByText("It will see you.")).toBeInTheDocument();
    });

    it("uses the labels the application offers", () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} />);
      host.push([access(1, { deny_label: "Never", grant_label: "Sure" })]);

      expect(screen.getByRole("button", { name: "Sure" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Never" })).toBeInTheDocument();
    });

    it("asks to share the user's name and picture, naming the application and its reason", async () => {
      const host = new FakeHost();
      render(
        <PortalDialogs
          host={host.host}
          systemOf={desktop({ "/home/ada/me.png": "png" })}
        />,
      );
      host.push([
        account(1, {
          image: "/home/ada/me.png",
          name: "Ada Lovelace",
          reason: "To sign you in",
        }),
      ]);

      expect(screen.getByRole("dialog")).toHaveTextContent(
        "Share your name and picture?",
      );
      expect(screen.getByText("org.example.Mail asks")).toBeInTheDocument();
      expect(screen.getByText("To sign you in")).toBeInTheDocument();
      expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
      expect(
        (await screen.findByRole("img", { name: "Ada Lovelace" })).getAttribute(
          "src",
        ),
      ).toStartWith("blob:");
    });

    it("asks to share the user's name without a reason or picture", () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} />);
      host.push([account(1, { name: "Ada Lovelace" })]);

      expect(screen.getByRole("dialog")).toHaveTextContent(
        "Share your name and picture?",
      );
      expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
      expect(screen.queryByRole("img")).not.toBeInTheDocument();
    });

    it("names an application it cannot identify", () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} />);
      host.push([{ ...access(1), app_id: "" }]);

      expect(screen.getByText("An application asks")).toBeInTheDocument();
    });

    it("names the application by its desktop entry", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} systemOf={desktop()} />);
      host.push([{ ...access(1), app_id: "firefox" }]);

      expect(await screen.findByText("Firefox asks")).toBeInTheDocument();
    });

    it("puts the dialog over the screen it is given", () => {
      const host = new FakeHost();
      render(
        <DisplayProvider source={TWO_SCREENS}>
          <PortalDialogs host={host.host} screen="right" />
        </DisplayProvider>,
      );
      host.push([access(1)]);

      expect(screen.getByRole("dialog").parentElement?.style.left).toBe(
        "1920px",
      );
    });

    it("offers each choice by name and icon, the default picked", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} systemOf={desktop()} />);
      host.push([chooser(1)]);

      expect(screen.getByRole("dialog")).toHaveTextContent(
        "Open report.pdf with",
      );
      const firefox = await screen.findByRole("option", { name: "Firefox" });
      expect(firefox).toHaveAttribute("aria-selected", "true");
      expect(
        screen.getByRole("option", { name: "Document Viewer" }),
      ).toHaveAttribute("aria-selected", "false");
      expect(firefox.querySelector("img")?.getAttribute("src")).toStartWith(
        "data:image/svg+xml",
      );
    });

    it("picks the last choice over the default", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} systemOf={desktop()} />);
      host.push([chooser(1, { last_choice: "org.gnome.Evince" })]);

      expect(
        await screen.findByRole("option", { name: "Document Viewer" }),
      ).toHaveAttribute("aria-selected", "true");
    });

    it("names a choice with no desktop entry by its id, and a URI", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} systemOf={desktop()} />);
      host.push([
        chooser(1, {
          choices: ["org.example.Gone"],
          content_type: undefined,
          filename: undefined,
          uri: "https://example.com/",
        }),
      ]);

      expect(
        await screen.findByRole("option", { name: "org.example.Gone" }),
      ).toHaveAttribute("aria-selected", "true");
      expect(screen.getByRole("dialog")).toHaveTextContent(
        "Open https://example.com/ with",
      );
    });

    it("shows choices the application adds while it is up", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} systemOf={desktop()} />);
      host.push([chooser(1, { choices: ["org.gnome.Evince"] })]);
      await screen.findByRole("option", { name: "Document Viewer" });
      host.push([chooser(1)]);

      expect(
        await screen.findByRole("option", { name: "Firefox" }),
      ).toBeInTheDocument();
    });

    it("reviews each shortcut an application asks for", () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} />);
      host.push([shortcuts(5)]);

      expect(screen.getByRole("dialog")).toHaveTextContent(
        "org.example.App wants shortcuts that work in any window",
      );
      expect(screen.getByRole("textbox", { name: "Push to talk" })).toHaveValue(
        "CTRL+ALT+t",
      );
      expect(screen.getByRole("textbox", { name: "Mute" })).toHaveValue("");
    });

    it("flags a chord the shell or another application holds", () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} shellChords={["Meta+Alt+d"]} />);
      host.push([shortcuts(5)]);

      expect(
        screen.getByText("org.example.Other uses this chord"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("The desktop uses this chord"),
      ).toBeInTheDocument();
    });

    it("will not bind a trigger that is not a chord", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} />);
      host.push([shortcuts(5)]);
      await userEvent.type(
        screen.getByRole("textbox", { name: "Mute" }),
        "Hyper+m",
      );

      expect(screen.getByRole("button", { name: "Bind" })).toBeDisabled();
    });

    it("previews a wallpaper, naming the application and where it goes", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} systemOf={withPicture} />);
      host.push([wallpaper(1)]);
      await act(() => Promise.resolve());

      expect(screen.getByRole("dialog")).toHaveTextContent(
        "org.example.Photos wants to change the wallpaper",
      );
      expect(screen.getByText("Desktop and lock screen")).toBeInTheDocument();
      expect(
        screen
          .getByRole("img", { name: "The new wallpaper" })
          .getAttribute("src"),
      ).toStartWith("blob:");
    });

    it("shows a launcher's icon, name and address", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} systemOf={desktop()} />);
      host.push([launcher(1)]);
      await named();

      expect(screen.getByRole("dialog")).toHaveTextContent(
        "org.example.Browser wants to add an app",
      );
      expect(screen.getByLabelText("Name")).toHaveValue("Mail");
      expect(screen.getByText("https://mail.example.com")).toBeInTheDocument();
      expect(
        screen.getByRole("img", { name: "App icon" }).getAttribute("src"),
      ).toBe("data:image/png;base64,iVBORw==");
    });

    it("keeps a launcher's name when it may not be changed", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} systemOf={desktop()} />);
      host.push([launcher(1, { editable_name: false })]);
      await named();

      expect(screen.getByLabelText("Name")).toHaveAttribute("readonly");
    });

    it("lists the USB devices an application asks for", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} systemOf={desktop()} />);
      host.push([usb(1)]);
      await named();

      expect(screen.getByRole("dialog")).toHaveTextContent(
        "org.example.Keys wants to use USB devices",
      );
      expect(screen.getByText("Yubico.com YubiKey 5")).toBeInTheDocument();
      expect(screen.getByText("Unknown device")).toBeInTheDocument();
      expect(screen.getByText("Read and write")).toBeInTheDocument();
      expect(screen.getByText("Read only")).toBeInTheDocument();
    });

    it("goes away when the request does", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} />);
      host.push([access(1)]);
      host.push([]);

      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });
    });
  });

  describe("file chooser", () => {
    it("asks for files under the application's title, in its folder", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} systemOf={home()} />);
      host.push([
        fileChooser(1, {
          accept_label: "Attach",
          current_folder: "/home/me/Documents",
        }),
      ]);
      await listed();

      expect(
        screen.getByRole("dialog", { name: "Open Notes" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("option", { name: "report.pdf" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Attach" }),
      ).toBeInTheDocument();
    });

    it("answers with the file chosen, the filter and each choice", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} systemOf={home()} />);
      host.push([
        fileChooser(1, {
          choices: [
            {
              id: "encoding",
              initial: "utf8",
              label: "Encoding",
              options: [
                { id: "utf8", label: "UTF-8" },
                { id: "latin1", label: "Latin-1" },
              ],
            },
            {
              id: "readonly",
              initial: "false",
              label: "Read only",
              options: [],
            },
          ],
          current_filter: 1,
          filters: [
            { extensions: ["png"], name: "Images" },
            { extensions: ["txt"], name: "Text" },
          ],
        }),
      ]);
      await listed();
      await userEvent.click(
        screen.getByRole("combobox", { name: "Read only" }),
      );
      await userEvent.click(screen.getByRole("option", { name: "Yes" }));
      await userEvent.click(screen.getByRole("combobox", { name: "Encoding" }));
      await userEvent.click(screen.getByRole("option", { name: "Latin-1" }));
      await userEvent.dblClick(
        screen.getByRole("option", { name: "notes.txt" }),
      );

      expect(host.answers).toEqual([
        [
          1,
          {
            choices: { encoding: "latin1", readonly: "true" },
            current_filter: 1,
            kind: "file_chooser",
            paths: ["/home/me/notes.txt"],
          },
        ],
      ]);
    });

    it("opens several files", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} systemOf={home()} />);
      host.push([fileChooser(1, { multiple: true })]);
      await listed();

      expect(
        screen.getByRole("listbox", { name: "Contents of ~" }),
      ).toHaveAttribute("aria-multiselectable", "true");
    });

    it("chooses a folder", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} systemOf={home()} />);
      host.push([fileChooser(1, { directory: true })]);
      await listed();
      await userEvent.click(screen.getByRole("button", { name: "Choose" }));

      expect(host.answers).toEqual([
        [1, { choices: {}, kind: "file_chooser", paths: ["/home/me"] }],
      ]);
    });

    it("saves under the name suggested", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} systemOf={home()} />);
      host.push([fileChooser(1, { current_name: "draft.txt", mode: "save" })]);
      await listed();
      await userEvent.click(screen.getByRole("button", { name: "Save" }));

      expect(host.answers).toEqual([
        [
          1,
          { choices: {}, kind: "file_chooser", paths: ["/home/me/draft.txt"] },
        ],
      ]);
    });

    it("saves several files into the folder chosen", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} systemOf={home()} />);
      host.push([
        fileChooser(1, { files: ["a.txt", "b.txt"], mode: "save_files" }),
      ]);
      await listed();

      expect(screen.getByText("Saves a.txt, b.txt")).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(host.answers).toEqual([
        [1, { choices: {}, kind: "file_chooser", paths: ["/home/me"] }],
      ]);
    });

    it("cancels", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} systemOf={home()} />);
      host.push([fileChooser(1)]);
      await listed();
      await userEvent.click(
        within(screen.getByRole("dialog")).getByRole("button", {
          name: "Cancel",
        }),
      );

      expect(host.answers).toEqual([[1, { kind: "canceled" }]]);
    });

    it("goes over the screen of the window that asked", async () => {
      const host = new FakeHost();
      render(
        <DisplayProvider source={TWO_SCREENS}>
          <PortalDialogs
            host={host.host}
            screen="left"
            screenOf={(appId) => (appId === "app-3" ? "right" : undefined)}
            systemOf={home()}
          />
        </DisplayProvider>,
      );
      host.push([{ ...fileChooser(1), parent_app_id: "app-3" }]);
      await listed();

      expect(screen.getByRole("dialog").parentElement?.style.left).toBe(
        "1920px",
      );
    });
  });

  describe("answers", () => {
    it("allows", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} />);
      host.push([access(1)]);
      await userEvent.click(screen.getByRole("button", { name: "Allow" }));

      expect(host.answers).toEqual([[1, { kind: "access" }]]);
    });

    it("denies", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} />);
      host.push([access(1)]);
      await userEvent.click(screen.getByRole("button", { name: "Deny" }));

      expect(host.answers).toEqual([[1, { kind: "canceled" }]]);
    });

    it("shares the user's name", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} />);
      host.push([account(1)]);
      await userEvent.click(screen.getByRole("button", { name: "Share" }));

      expect(host.answers).toEqual([[1, { kind: "access" }]]);
    });

    it("keeps the user's name", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} />);
      host.push([account(1)]);
      await userEvent.click(
        screen.getByRole("button", { name: "Don't share" }),
      );

      expect(host.answers).toEqual([[1, { kind: "canceled" }]]);
    });

    it("cancels on Escape", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} />);
      host.push([access(1)]);
      await userEvent.keyboard("{Escape}");

      expect(host.answers).toEqual([[1, { kind: "canceled" }]]);
    });

    it("opens the picked application", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} systemOf={desktop()} />);
      host.push([chooser(1)]);
      await screen.findByRole("option", { name: "Firefox" });
      await userEvent.click(screen.getByRole("button", { name: "Open" }));

      expect(host.answers).toEqual([
        [1, { choice: "firefox", kind: "app_chooser" }],
      ]);
    });

    it("moves the pick with the arrows and opens it with Enter", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} systemOf={desktop()} />);
      host.push([chooser(1)]);
      await screen.findByRole("option", { name: "Firefox" });
      await userEvent.keyboard("{ArrowUp}{Enter}");

      expect(host.answers).toEqual([
        [1, { choice: "org.gnome.Evince", kind: "app_chooser" }],
      ]);
    });

    it("opens an application double-clicked", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} systemOf={desktop()} />);
      host.push([chooser(1)]);
      await userEvent.dblClick(
        await screen.findByRole("option", { name: "Document Viewer" }),
      );

      expect(host.answers).toEqual([
        [1, { choice: "org.gnome.Evince", kind: "app_chooser" }],
      ]);
    });

    it("cancels a choice", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} systemOf={desktop()} />);
      host.push([chooser(1)]);
      await screen.findByRole("option", { name: "Firefox" });
      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

      expect(host.answers).toEqual([[1, { kind: "canceled" }]]);
    });

    it("leaves an inhibitor alone and asks what comes after it", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} systemOf={desktop()} />);
      host.push([
        {
          app_id: "org.example.Editor",
          body: { what: ["logout"] },
          id: 5,
          kind: "inhibit",
        },
        access(6),
      ]);
      await named();

      expect(host.answers).toEqual([]);
      expect(screen.getByRole("dialog")).toHaveTextContent("Use the camera?");
    });

    it("binds the chords the user accepts, changes and clears", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} />);
      host.push([shortcuts(5)]);
      await userEvent.clear(screen.getByRole("textbox", { name: "Mute" }));
      await userEvent.type(
        screen.getByRole("textbox", { name: "Mute" }),
        "shift+ctrl+m",
      );
      await userEvent.clear(screen.getByRole("textbox", { name: "Deafen" }));
      await userEvent.click(screen.getByRole("button", { name: "Bind" }));

      expect(host.answers).toEqual([
        [
          5,
          {
            kind: "global_shortcuts",
            triggers: [
              { id: "talk", trigger: "Ctrl+Alt+t" },
              { id: "mute", trigger: "Ctrl+Shift+m" },
              { id: "deafen" },
            ],
          },
        ],
      ]);
    });

    it("binds nothing when dismissed", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} />);
      host.push([shortcuts(5)]);
      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

      expect(host.answers).toEqual([[5, { kind: "canceled" }]]);
    });

    it("reports a press of a chord an application holds", () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} />);
      host.push([], undefined, [
        { app_id: "org.example.App", chord: "Ctrl+Alt+t", id: 3 },
      ]);
      act(() => {
        host.fake.dispatch("shortcut", { chord: "Ctrl+Alt+t" });
      });

      expect(host.answers).toEqual([[3, { kind: "pressed" }]]);
    });

    it("sets a wallpaper", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} systemOf={withPicture} />);
      host.push([wallpaper(1)]);
      await userEvent.click(screen.getByRole("button", { name: "Set" }));

      expect(host.answers).toEqual([[1, { kind: "access" }]]);
    });

    it("keeps the wallpaper", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} systemOf={withPicture} />);
      host.push([wallpaper(1)]);
      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

      expect(host.answers).toEqual([[1, { kind: "canceled" }]]);
    });

    it("installs a launcher under the name typed", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} systemOf={desktop()} />);
      host.push([launcher(1)]);
      await userEvent.clear(screen.getByLabelText("Name"));
      await userEvent.type(screen.getByLabelText("Name"), "Work mail");
      await userEvent.click(screen.getByRole("button", { name: "Add" }));

      expect(host.answers).toEqual([
        [1, { kind: "dynamic_launcher", name: "Work mail" }],
      ]);
    });

    it("cannot install a launcher with no name", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} systemOf={desktop()} />);
      host.push([launcher(1)]);
      await userEvent.clear(screen.getByLabelText("Name"));

      expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
    });

    it("allows the USB devices", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} systemOf={desktop()} />);
      host.push([usb(1)]);
      await userEvent.click(screen.getByRole("button", { name: "Allow" }));

      expect(host.answers).toEqual([[1, { kind: "access" }]]);
    });

    it("refuses a kind it has no dialog for", () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} />);
      host.push([{ app_id: "", body: {}, id: 4, kind: "wobble" }]);

      expect(host.answers).toEqual([[4, { kind: "refused" }]]);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
  describe("remote desktop", () => {
    it("offers each device asked for, all on, and the clipboard", () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} />);
      host.push([remoteDesktop(1, true)]);

      expect(screen.getByRole("dialog")).toHaveTextContent(
        "org.example.Remote wants to control your computer",
      );
      expect(
        screen.queryByRole("switch", { name: "Touchscreen" }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole("switch", { name: "Keyboard" })).toBeChecked();
      expect(screen.getByRole("switch", { name: "Pointer" })).toBeChecked();
      expect(
        screen.getByRole("switch", { name: "Share clipboard" }),
      ).toBeChecked();
    });

    it("offers no clipboard when none was asked for", () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} />);
      host.push([remoteDesktop(1, false)]);

      expect(
        screen.queryByRole("switch", { name: "Share clipboard" }),
      ).not.toBeInTheDocument();
    });

    it("grants what is left on", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} />);
      host.push([remoteDesktop(1, true)]);
      await userEvent.click(screen.getByRole("switch", { name: "Keyboard" }));
      await userEvent.click(
        screen.getByRole("switch", { name: "Share clipboard" }),
      );
      await userEvent.click(screen.getByRole("button", { name: "Allow" }));

      expect(host.answers).toEqual([
        [
          1,
          {
            clipboard: false,
            devices: { keyboard: false, pointer: true, touchscreen: false },
            kind: "remote_desktop",
          },
        ],
      ]);
    });

    it("denies", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} />);
      host.push([remoteDesktop(1, true)]);
      await userEvent.click(screen.getByRole("button", { name: "Deny" }));

      expect(host.answers).toEqual([[1, { kind: "canceled" }]]);
    });
  });

  describe("input capture", () => {
    it("names the application and the devices it would take", () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} />);
      host.push([inputCapture(1)]);

      expect(screen.getByRole("dialog")).toHaveTextContent(
        "org.example.Barrier wants to capture your keyboard and pointer when the pointer leaves the screen.",
      );
    });

    it("allows", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} />);
      host.push([inputCapture(1)]);
      await userEvent.click(screen.getByRole("button", { name: "Allow" }));

      expect(host.answers).toEqual([[1, { kind: "input_capture" }]]);
    });

    it("denies", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} />);
      host.push([inputCapture(1)]);
      await userEvent.click(screen.getByRole("button", { name: "Deny" }));

      expect(host.answers).toEqual([[1, { kind: "canceled" }]]);
    });
  });

  describe("print", () => {
    const twoPrinters = [
      printer("office", { color_mode: "monochrome", sides: "one_sided" }),
      printer("lab", { media: "na_letter_8.5x11in" }),
    ];

    it("prints the starting printer's options as they stand", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} />);
      host.push([print(1, twoPrinters)]);

      expect(screen.getByRole("dialog")).toHaveTextContent(
        "org.example.Editor prints “Report”",
      );
      expect(
        screen.getByRole("combobox", { name: "Printer" }).textContent,
      ).toContain("office printer");
      expect(screen.queryByRole("combobox", { name: "Quality" })).toBeNull();
      await userEvent.click(screen.getByRole("button", { name: "Print it" }));

      expect(host.answers).toEqual([
        [
          1,
          {
            kind: "print",
            options: {
              color_mode: "monochrome",
              copies: 1,
              media: "iso_a4_210x297mm",
              pages: [],
              sides: "one_sided",
            },
            printer: "office",
          },
        ],
      ]);
    });

    it("takes another printer's options, copies, pages and paper", async () => {
      const user = userEvent.setup();
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} />);
      host.push([print(1, twoPrinters)]);

      await user.click(screen.getByRole("combobox", { name: "Printer" }));
      await user.click(screen.getByRole("option", { name: "lab printer" }));
      await user.click(screen.getByRole("combobox", { name: "Orientation" }));
      await user.click(screen.getByRole("option", { name: "Landscape" }));
      await user.clear(screen.getByRole("spinbutton", { name: "Copies" }));
      await user.type(screen.getByRole("spinbutton", { name: "Copies" }), "3");
      await user.type(screen.getByRole("textbox", { name: "Pages" }), "1-2, 5");
      await user.click(screen.getByRole("button", { name: "Print it" }));

      expect(host.answers).toEqual([
        [
          1,
          {
            kind: "print",
            options: {
              copies: 3,
              media: "na_letter_8.5x11in",
              orientation: "landscape",
              pages: [
                { first: 1, last: 2 },
                { first: 5, last: 5 },
              ],
            },
            printer: "lab",
          },
        ],
      ]);
    });

    it("will not print pages it cannot read or more copies than allowed", async () => {
      const user = userEvent.setup();
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} />);
      host.push([print(1, twoPrinters)]);

      await user.type(screen.getByRole("textbox", { name: "Pages" }), "3-1");
      expect(screen.getByRole("button", { name: "Print it" })).toBeDisabled();
      await user.clear(screen.getByRole("textbox", { name: "Pages" }));
      await user.clear(screen.getByRole("spinbutton", { name: "Copies" }));
      await user.type(screen.getByRole("spinbutton", { name: "Copies" }), "10");
      expect(screen.getByRole("button", { name: "Print it" })).toBeDisabled();
    });

    it("says there are no printers and closes as canceled", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} />);
      host.push([print(1, [], "")]);

      expect(screen.getByText("No printers are set up.")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Print it" })).toBeNull();
      await userEvent.click(screen.getByRole("button", { name: "Close" }));

      expect(host.answers).toEqual([[1, { kind: "canceled" }]]);
    });

    it("cancels", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} />);
      host.push([print(1, twoPrinters)]);
      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

      expect(host.answers).toEqual([[1, { kind: "canceled" }]]);
    });
  });

  describe("screenshot", () => {
    it("shows the frozen desk and offers it whole, each screen and each window", () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} />);
      host.push([frozen(1, "screenshot")]);

      expect(screen.getByRole("img", { name: "The desk" })).toHaveAttribute(
        "src",
        "data:image/png;base64,AA==",
      );
      expect(screen.getByRole("dialog")).toHaveTextContent(
        "org.example.Shooter asks",
      );
      expect(
        screen.getByRole("button", { name: "Whole desk" }),
      ).toHaveAttribute("aria-pressed", "true");
      expect(
        within(screen.getByRole("group", { name: "Screens" })).getByRole(
          "button",
          { name: "DP-1" },
        ),
      ).toHaveAttribute("aria-pressed", "false");
      expect(
        within(screen.getByRole("group", { name: "Windows" })).getByRole(
          "button",
          { name: "kitty: ~/src" },
        ),
      ).toBeInTheDocument();
    });

    it("names each window by its application, with its icon", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} systemOf={desktop()} />);
      const shot = frozen(1, "screenshot");
      const area = { height: 1, width: 1, x: 0, y: 0 };
      host.push([
        {
          ...shot,
          body: {
            ...shot.body,
            windows: [
              { app_id: "firefox", area, title: "Notes" },
              { app_id: "", area, title: "" },
            ],
          },
        },
      ]);

      const notes = await screen.findByRole("button", {
        name: "Firefox: Notes",
      });
      expect(
        within(notes).getByRole("presentation").getAttribute("src"),
      ).toStartWith("data:image/svg+xml");
      expect(
        screen.getByRole("button", { name: "Untitled window" }),
      ).toBeInTheDocument();
    });

    it("offers each browser window the page draws, where it is on the frame", async () => {
      const host = new FakeHost();
      host.fake.set({
        browserWindows: [
          browserWindow("1", "Pull requests"),
          browserWindow("2", "Hidden"),
        ],
      });
      const views = [
        // Past the desk's right edge, at 140.
        webview("1", { height: 40, width: 100, x: 50, y: 10 }),
        // On another workspace: drawn nowhere.
        webview("2", { height: 0, width: 0, x: 0, y: 0 }),
        // The shell's own page, such as a preview.
        webview(undefined, { height: 40, width: 100, x: 0, y: 0 }),
      ];
      render(<PortalDialogs host={host.host} />);
      host.push([frozen(1, "screenshot")]);
      const windows = within(screen.getByRole("group", { name: "Windows" }));
      expect(
        windows.getAllByRole("button").map((button) => button.textContent),
      ).toEqual(["kitty: ~/src", "Browser: Pull requests"]);
      await userEvent.click(
        windows.getByRole("button", { name: "Browser: Pull requests" }),
      );
      await userEvent.click(screen.getByRole("button", { name: "Save" }));
      for (const view of views) {
        view.remove();
      }

      expect(host.answers).toEqual([
        [
          1,
          {
            area: { height: 80, width: 180, x: 120, y: 20 },
            kind: "screenshot",
          },
        ],
      ]);
    });

    it("names no asker when the shell asked for it", () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} />);
      host.push([{ ...frozen(1, "screenshot"), app_id: SHELL_APP_ID }]);

      expect(screen.getByRole("dialog")).toHaveTextContent("Take a screenshot");
      expect(screen.getByRole("dialog")).not.toHaveTextContent("asks");
    });

    it("saves the whole desk", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} />);
      host.push([frozen(1, "screenshot")]);
      await userEvent.click(screen.getByRole("button", { name: "Save" }));

      expect(host.answers).toEqual([
        [
          1,
          {
            area: { height: 100, width: 300, x: 0, y: 0 },
            kind: "screenshot",
          },
        ],
      ]);
    });

    it("saves the window picked", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} />);
      host.push([frozen(1, "screenshot")]);
      await userEvent.click(
        screen.getByRole("button", { name: "kitty: ~/src" }),
      );
      await userEvent.click(screen.getByRole("button", { name: "Save" }));

      expect(host.answers).toEqual([
        [
          1,
          { area: { height: 40, width: 30, x: 10, y: 20 }, kind: "screenshot" },
        ],
      ]);
    });

    it("saves an area dragged on the desk", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} />);
      host.push([frozen(1, "screenshot")]);
      const desk = drawnAtHalfSize(
        screen.getByRole("group", { name: "Drag to pick an area" }),
      );
      fireEvent.pointerDown(desk, { clientX: 60, clientY: 30 });
      fireEvent.pointerMove(desk, { clientX: 20, clientY: 45 });
      fireEvent.pointerUp(desk, { clientX: 20, clientY: 45 });
      await userEvent.click(screen.getByRole("button", { name: "Save" }));

      expect(host.answers).toEqual([
        [
          1,
          { area: { height: 31, width: 81, x: 20, y: 20 }, kind: "screenshot" },
        ],
      ]);
    });

    it("cancels", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} />);
      host.push([frozen(1, "screenshot")]);
      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

      expect(host.answers).toEqual([[1, { kind: "canceled" }]]);
    });
  });

  describe("pick color", () => {
    it("starts at the middle of the frozen desk", () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} />);
      host.push([frozen(1, "pick_color")]);

      expect(
        screen.getByRole("button", { name: "Pick the pixel at 150, 50" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("img", { name: "The desk" })).toBeInTheDocument();
    });

    it("picks the pixel the arrow keys move to", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} />);
      host.push([frozen(1, "pick_color")]);
      screen.getByRole("button", { name: /^Pick the pixel/ }).focus();
      await userEvent.keyboard("{ArrowRight}{ArrowRight}{ArrowUp}{Enter}");

      expect(host.answers).toEqual([
        [1, { kind: "pick_color", x: 152, y: 49 }],
      ]);
    });

    it("picks the pixel clicked", () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} />);
      host.push([frozen(1, "pick_color")]);
      const desk = drawnAtHalfSize(
        screen.getByRole("button", { name: /^Pick the pixel/ }),
      );
      fireEvent.pointerMove(desk, { clientX: 15, clientY: 69 });

      expect(desk).toHaveAccessibleName("Pick the pixel at 10, 98");
      fireEvent.click(desk, { clientX: 15, clientY: 69 });
      expect(host.answers).toEqual([[1, { kind: "pick_color", x: 10, y: 98 }]]);
    });

    it("cancels", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} />);
      host.push([frozen(1, "pick_color")]);
      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

      expect(host.answers).toEqual([[1, { kind: "canceled" }]]);
    });
  });

  describe("capturing", () => {
    it("shows nothing while no session runs", () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} />);
      host.push([]);

      expect(screen.queryByRole("list")).not.toBeInTheDocument();
    });

    it("names each session's application and what it holds", () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} />);
      host.push(
        [],
        [
          remoteDesktop(5, true),
          inputCapture(6),
          {
            app_id: "us.zoom.Zoom",
            body: {
              sources: [
                { id: "app-3", title: "Notes", type: "window" },
                { id: "app-4", title: "", type: "window" },
                { name: "drm-1", type: "monitor" },
                { position: [0, 0], size: [10, 10], type: "region" },
              ],
            },
            id: 7,
            kind: "screen_cast",
          },
          { app_id: "", body: {}, id: 8, kind: "screenshot" },
        ],
      );

      expect(
        screen
          .getAllByRole("listitem")
          .map((item) => item.firstChild?.textContent),
      ).toEqual([
        "Remote control: org.example.Remote — keyboard, pointer, clipboard",
        "Input capture: org.example.Barrier — keyboard, pointer",
        "Sharing: us.zoom.Zoom — Notes, Untitled window, Screen drm-1, Region",
        "screenshot: An application",
      ]);
    });

    it("names a session's application by its desktop entry, with its icon", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} systemOf={desktop()} />);
      host.push([], [{ ...inputCapture(6), app_id: "firefox" }]);

      expect(
        await screen.findByText("Input capture: Firefox — keyboard, pointer"),
      ).toBeInTheDocument();
      expect(screen.getByRole("presentation")).toHaveAttribute(
        "src",
        "data:image/svg+xml;base64,PHN2Zy8+",
      );
    });

    it("leaves screen casts out when the shell shows them", () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} omitScreenCasts />);
      host.push(
        [],
        [
          inputCapture(6),
          {
            app_id: "us.zoom.Zoom",
            body: { sources: [] },
            id: 7,
            kind: "screen_cast",
          },
        ],
      );

      expect(
        screen.getAllByRole("listitem").map((item) => item.textContent),
      ).toEqual(["Input capture: org.example.Barrier — keyboard, pointerStop"]);
    });

    it("stops a session", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} />);
      host.push([], [remoteDesktop(5, false), inputCapture(6)]);
      const [, capture] = screen.getAllByRole("listitem");
      if (capture === undefined) {
        throw new Error("no second session");
      }
      await userEvent.click(
        within(capture).getByRole("button", { name: "Stop" }),
      );

      expect(host.answers).toEqual([[6, { kind: "stop" }]]);
    });
  });
});

describe("screen cast", () => {
  it("lists the windows with their applications' names and icons", async () => {
    const host = new FakeHost();
    render(<PortalDialogs host={host.host} systemOf={desktop()} />);
    host.push([screenCast()]);

    expect(screen.getByRole("dialog")).toHaveTextContent("Share a window");
    expect(
      screen.getByText("us.zoom.Zoom wants to record"),
    ).toBeInTheDocument();
    const notes = await screen.findByRole("button", { name: "Firefox: Notes" });
    expect(
      within(notes).getByRole("presentation").getAttribute("src"),
    ).toStartWith("data:image/svg+xml");
    expect(
      screen.getByRole("button", { name: "Untitled window" }),
    ).toBeInTheDocument();
  });

  it("shares nothing until a window is picked", () => {
    const host = new FakeHost();
    render(<PortalDialogs host={host.host} />);
    host.push([screenCast()]);

    expect(screen.getByRole("button", { name: "Share" })).toBeDisabled();
  });

  it("shares the window picked", async () => {
    const host = new FakeHost();
    render(<PortalDialogs host={host.host} />);
    host.push([screenCast()]);
    await userEvent.click(
      screen.getByRole("button", { name: "firefox: Notes" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Share" }));

    expect(host.answers).toEqual([
      [5, { kind: "screen_cast", sources: [{ id: "app-3", type: "window" }] }],
    ]);
  });

  it("picks one window unless the application asks for more", async () => {
    const host = new FakeHost();
    render(<PortalDialogs host={host.host} />);
    host.push([screenCast()]);
    await userEvent.click(
      screen.getByRole("button", { name: "firefox: Notes" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Untitled window" }),
    );

    expect(
      screen.getByRole("button", { name: "firefox: Notes" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.getByRole("button", { name: "Untitled window" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("shares several windows when the application asks for more", async () => {
    const host = new FakeHost();
    render(<PortalDialogs host={host.host} />);
    host.push([screenCast(true)]);
    await userEvent.click(
      screen.getByRole("button", { name: "firefox: Notes" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Untitled window" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Share" }));

    expect(host.answers).toEqual([
      [
        5,
        {
          kind: "screen_cast",
          sources: [
            { id: "app-3", type: "window" },
            { id: "app-4", type: "window" },
          ],
        },
      ],
    ]);
  });

  it("cancels", async () => {
    const host = new FakeHost();
    render(<PortalDialogs host={host.host} />);
    host.push([screenCast()]);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(host.answers).toEqual([[5, { kind: "canceled" }]]);
  });

  describe("screens", () => {
    it("lists each screen by name and panel", () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} />);
      host.push([screenCast(false, MONITORS)]);

      expect(screen.getByRole("dialog")).toHaveTextContent("Share a screen");
      expect(
        screen.getByRole("button", { name: "drm-1: Dell Inc. DELL U3219Q" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "drm-2" })).toBeInTheDocument();
      expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    });

    it("puts windows and screens on tabs and shares from either", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} />);
      host.push([screenCast(true, [...WINDOWS, ...MONITORS])]);
      await userEvent.click(
        screen.getByRole("button", { name: "firefox: Notes" }),
      );
      await userEvent.click(screen.getByRole("tab", { name: "Screens" }));
      await userEvent.click(screen.getByRole("button", { name: "drm-2" }));
      await userEvent.click(screen.getByRole("button", { name: "Share" }));

      expect(host.answers).toEqual([
        [
          5,
          {
            kind: "screen_cast",
            sources: [
              { id: "app-3", type: "window" },
              { name: "drm-2", type: "monitor" },
            ],
          },
        ],
      ]);
    });

    it("picks one source across the tabs unless the application asks for more", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} />);
      host.push([screenCast(false, [...WINDOWS, ...MONITORS])]);
      await userEvent.click(
        screen.getByRole("button", { name: "firefox: Notes" }),
      );
      await userEvent.click(screen.getByRole("tab", { name: "Screens" }));
      await userEvent.click(screen.getByRole("button", { name: "drm-2" }));
      await userEvent.click(screen.getByRole("button", { name: "Share" }));

      expect(host.answers).toEqual([
        [
          5,
          {
            kind: "screen_cast",
            sources: [{ name: "drm-2", type: "monitor" }],
          },
        ],
      ]);
    });
  });

  describe("region", () => {
    it("is offered only when the application asks for one", () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} />);
      host.push([screenCast()]);

      expect(
        screen.queryByRole("button", { name: "Draw a region" }),
      ).not.toBeInTheDocument();
    });

    it("shares the rectangle dragged on the desk", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} />);
      host.push([screenCast(false, MONITORS, true)]);
      await userEvent.click(
        screen.getByRole("button", { name: "Draw a region" }),
      );
      const desk = screen.getByRole("application", {
        name: "Drag to pick a region to share",
      });
      fireEvent.pointerDown(desk, { clientX: 300, clientY: 200 });
      fireEvent.pointerMove(desk, { clientX: 100, clientY: 50 });
      fireEvent.pointerUp(desk, { clientX: 100, clientY: 50 });

      expect(host.answers).toEqual([
        [
          5,
          {
            kind: "screen_cast",
            sources: [
              { position: [100, 50], size: [200, 150], type: "region" },
            ],
          },
        ],
      ]);
    });

    it("goes back to the picker on Escape", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} />);
      host.push([screenCast(false, MONITORS, true)]);
      await userEvent.click(
        screen.getByRole("button", { name: "Draw a region" }),
      );
      await userEvent.keyboard("{Escape}");

      expect(
        await screen.findByRole("button", { name: "Draw a region" }),
      ).toBeInTheDocument();
      expect(host.answers).toEqual([]);
    });

    it("ignores a click that draws nothing", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host.host} />);
      host.push([screenCast(false, MONITORS, true)]);
      await userEvent.click(
        screen.getByRole("button", { name: "Draw a region" }),
      );
      const desk = screen.getByRole("application", {
        name: "Drag to pick a region to share",
      });
      fireEvent.pointerDown(desk, { clientX: 300, clientY: 200 });
      fireEvent.pointerUp(desk, { clientX: 300, clientY: 200 });

      expect(host.answers).toEqual([]);
    });
  });
});

const TWO_SCREENS = {
  displays: [
    { name: "left", position: [0, 0], scale: 1, size: [1920, 1080] },
    { name: "right", position: [1920, 0], scale: 1, size: [1920, 1080] },
  ],
  onDisplays: () => () => undefined,
} satisfies DisplaySource;
