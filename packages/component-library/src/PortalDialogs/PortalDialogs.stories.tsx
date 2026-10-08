import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import type { GlobalShortcutsHost } from "@domicile-desktop/sdk/global-shortcuts";
import type { SystemHost } from "@domicile-desktop/sdk/system";
import { fakeSystem } from "@domicile-desktop/system-apps/fake-system";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { PortalDialogs } from "./PortalDialogs";

/**
 * A desktop that pushes `items` and `capturing` once. Answers go to the
 * console; nothing goes away, since no compositor takes it away.
 */
const pushing = (
  items: readonly object[],
  capturing: readonly object[] = [],
): GlobalShortcutsHost & SystemHost => {
  const fake = new FakeDomicileHost();
  const data = JSON.stringify({ capturing, items, type: "portal_requests" });
  const host: GlobalShortcutsHost = {
    addEventListener: (type, listener) => {
      fake.host.addEventListener(type, listener);
      // The engine replays the requests to a late listener.
      if (type === "portalrequests") {
        queueMicrotask(() => {
          fake.dispatch("portalrequests", { data });
        });
      }
    },
    answerPortalRequest: (id, answer) => {
      // biome-ignore lint/suspicious/noConsole: the story shows its answers in the console
      console.info("answered", id, answer);
    },
    grabShortcut: () => undefined,
    removeEventListener: (type, listener) => {
      fake.host.removeEventListener(type, listener);
    },
  };
  return { ...host, callSystem: () => undefined };
};

const access = {
  app_id: "org.example.Camera",
  body: {
    body: "It can see you until it closes.",
    subtitle: "Camera wants to use your webcam",
    title: "Allow the camera?",
  },
  id: 1,
  kind: "access",
};

const appChooser = {
  app_id: "org.example.Mail",
  body: {
    choices: ["org.gnome.Evince", "firefox", "org.example.Unknown"],
    content_type: "application/pdf",
    filename: "invoice.pdf",
  },
  id: 2,
  kind: "app_chooser",
};

const account = {
  app_id: "org.example.Mail",
  body: {
    name: "Ada Lovelace",
    reason: "Mail signs your messages with your name.",
  },
  id: 8,
  kind: "account",
};

const wallpaper = {
  app_id: "org.example.Photos",
  body: { path: "/home/u/Pictures/dusk.png", set_on: "both" },
  id: 3,
  kind: "wallpaper",
};

/** A small dusk gradient, standing in for a photograph. */
const DUSK_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAASCAIAAAC1qksFAAAA3ElEQVR42mOQlCyQlc5Vks1WV8jUUUozUEkxVU+y0oy314l10Yv2MIjwNQ4LMg0JtwiMsfJPsPFNtffKcvTId3ErcXOu8HCs9bZv8rVpD7DqCbKYEGI6Ndx4VqTh/Bi9xXE6KxK01iarM9DU9E2pqgw0NX17hjIDTU3fnaXAQFPTD+TIMdDU9KP5Mgw0Nf1UoSQDTU0/XyLOQFPTL5eJMtDU9BsVQgw0Nf1utQADTU1/VMvHQFPTnzdwM9DU9NdNnAw0Nf1DCzsDTU3/2s7CQFPTf3UyMdDU9P89DACWx2/KpRK5igAAAABJRU5ErkJggg==";

/** A desktop holding the picture `wallpaper` names. */
const withPicture = () =>
  fakeSystem({
    "/home/u/Pictures/dusk.png": Uint8Array.from(atob(DUSK_PNG), (c) =>
      c.charCodeAt(0),
    ),
  });

const launcher = {
  app_id: "org.example.Browser",
  body: {
    editable_name: true,
    // A blue square.
    icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiPjxyZWN0IHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9IiMyNTYzZWIiLz48L3N2Zz4=",
    launcher_type: "webapp",
    name: "Mail",
    target: "https://mail.example.com",
  },
  id: 8,
  kind: "dynamic_launcher",
};

const usb = {
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
  id: 9,
  kind: "usb",
};

const officePrinter = {
  color_modes: ["color", "monochrome"],
  copies_max: 99,
  description: "Office laser",
  initial: {
    color_mode: "color",
    copies: 1,
    media: "iso_a4_210x297mm",
    orientation: "portrait",
    pages: [],
    sides: "one_sided",
  },
  media: [
    { label: "A4 (210 × 297 mm)", name: "iso_a4_210x297mm" },
    { label: "Letter (8.5 × 11 in)", name: "na_letter_8.5x11in" },
  ],
  name: "office",
  orientations: ["portrait", "landscape"],
  page_ranges: true,
  qualities: ["draft", "normal", "high"],
  sides: ["one_sided", "two_sided_long_edge", "two_sided_short_edge"],
};

const print = (printers: readonly object[]) => ({
  app_id: "org.example.Editor",
  body: { printer: "office", printers, title: "Quarterly report" },
  id: 9,
  kind: "print",
});

const entry = (name: string): string =>
  `[Desktop Entry]\nType=Application\nName=${name}\nExec=true\n`;

/** Two installed applications; the browser is the default for PDFs. */
const installed = () =>
  fakeSystem(
    {
      "/config/mimeapps.list":
        "[Default Applications]\napplication/pdf=firefox.desktop\n",
      "/share/applications/firefox.desktop": entry("Firefox"),
      "/share/applications/org.gnome.Evince.desktop": entry("Document Viewer"),
    },
    () => ({
      code: 0,
      stderr: "",
      stdout: "XDG_CONFIG_HOME=/config\0XDG_DATA_DIRS=/share\0",
    }),
  );

const fileChooser = {
  app_id: "org.example.Editor",
  body: {
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
      { id: "readonly", initial: "false", label: "Read only", options: [] },
    ],
    directory: false,
    files: [],
    filters: [
      { extensions: ["txt", "md"], name: "Text" },
      { extensions: [], name: "All files" },
    ],
    home: "/home/me",
    mode: "open",
    multiple: true,
    title: "Open Notes",
  },
  id: 3,
  kind: "file_chooser",
};

/** A small home for the file chooser to list. */
const home = () =>
  fakeSystem({
    "/home/me/Documents/letter.txt": "",
    "/home/me/Documents/report.pdf": "",
    "/home/me/notes.txt": "",
    "/home/me/Pictures/cat.png": "",
    "/home/me/todo.md": "",
  });

const remoteDesktop = {
  app_id: "org.example.Remote",
  body: {
    clipboard: true,
    devices: { keyboard: true, pointer: true, touchscreen: false },
  },
  id: 4,
  kind: "remote_desktop",
};

const inputCapture = {
  app_id: "org.example.Barrier",
  body: { devices: { keyboard: true, pointer: true, touchscreen: false } },
  id: 5,
  kind: "input_capture",
};

const globalShortcuts = {
  app_id: "org.example.Chat",
  body: {
    shortcuts: [
      { description: "Push to talk", id: "talk", trigger: "CTRL+ALT+t" },
      { description: "Mute", id: "mute", trigger: "Meta+Return" },
      { description: "Deafen", id: "deafen" },
    ],
    taken: [{ app_id: "org.example.Recorder", chord: "Ctrl+Alt+t" }],
  },
  id: 8,
  kind: "global_shortcuts",
};

const screenCast = {
  app_id: "us.zoom.Zoom",
  body: {
    multiple: false,
    region: true,
    sources: [
      { app_id: "firefox", id: "app-3", title: "Notes", type: "window" },
      {
        app_id: "org.gnome.Evince",
        id: "app-4",
        title: "report.pdf",
        type: "window",
      },
      { app_id: "", id: "app-5", title: "", type: "window" },
      {
        description: "Dell Inc. DELL U3219Q",
        name: "drm-1",
        size: [1920, 1080],
        type: "monitor",
      },
      { description: "", name: "drm-2", size: [1280, 800], type: "monitor" },
    ],
  },
  id: 2,
  kind: "screen_cast",
};

/** A drawn desk of two monitors, 1600x500, standing in for a captured one. */
const deskFrame = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="500">
    <rect width="1000" height="500" fill="#2b6cb0"/>
    <rect x="1000" width="600" height="500" fill="#9f7aea"/>
    <rect x="80" y="60" width="520" height="340" fill="#f7fafc"/>
    <rect x="1080" y="120" width="420" height="260" fill="#1a202c"/>
    <circle cx="800" cy="380" r="60" fill="#f6ad55"/>
  </svg>`,
)}`;

const frozenDesk = {
  frame: deskFrame,
  height: 500,
  monitors: [
    { area: { height: 500, width: 1000, x: 0, y: 0 }, name: "DP-1" },
    { area: { height: 500, width: 600, x: 1000, y: 0 }, name: "HDMI-A-1" },
  ],
  width: 1600,
  windows: [
    { area: { height: 340, width: 520, x: 80, y: 60 }, name: "Notes" },
    { area: { height: 260, width: 420, x: 1080, y: 120 }, name: "Terminal" },
  ],
};

const screenshot = {
  app_id: "org.example.Shooter",
  body: frozenDesk,
  id: 9,
  kind: "screenshot",
};

const pickColor = {
  app_id: "org.example.Paint",
  body: frozenDesk,
  id: 10,
  kind: "pick_color",
};

const meta = {
  args: {
    host: pushing([access]),
    screen: undefined,
    screenOf: undefined,
    shellChords: undefined,
    systemOf: undefined,
  },
  argTypes: {
    host: {
      control: false,
      table: { category: "Behavior" },
    },
    screen: {
      control: "text",
      table: { category: "Appearance" },
    },
    screenOf: {
      control: false,
      table: { category: "Appearance" },
    },
    shellChords: {
      control: "object",
      table: { category: "Behavior" },
    },
    systemOf: {
      control: false,
      table: { category: "Behavior" },
    },
  },
  component: PortalDialogs,
  parameters: {
    docs: {
      description: {
        component:
          "Draws the dialogs applications ask for through xdg-desktop-portal and answers them.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Overlays/PortalDialogs",
} satisfies Meta<typeof PortalDialogs>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Access: Story = {
  args: {
    host: pushing([access]),
    screen: undefined,
    screenOf: undefined,
    shellChords: undefined,
    systemOf: undefined,
  },
};

export const AppChooser: Story = {
  args: {
    host: pushing([appChooser]),
    screen: undefined,
    screenOf: undefined,
    shellChords: undefined,
    systemOf: installed,
  },
};

export const FileChooser: Story = {
  args: {
    host: pushing([fileChooser]),
    screen: undefined,
    screenOf: undefined,
    shellChords: undefined,
    systemOf: home,
  },
};

/**
 * A source picker for an application that may record one window or screen,
 * or draw a region.
 */
export const ScreenCast: Story = {
  args: {
    host: pushing([screenCast]),
    screen: undefined,
    screenOf: undefined,
    systemOf: installed,
  },
};

export const RemoteDesktop: Story = {
  args: {
    host: pushing([remoteDesktop]),
    screen: undefined,
    screenOf: undefined,
    shellChords: undefined,
    systemOf: undefined,
  },
};

export const InputCapture: Story = {
  args: {
    host: pushing([inputCapture]),
    screen: undefined,
    screenOf: undefined,
    shellChords: undefined,
    systemOf: undefined,
  },
};

export const Account: Story = {
  args: {
    host: pushing([account]),
    screen: undefined,
    screenOf: undefined,
    systemOf: undefined,
  },
};

export const DynamicLauncher: Story = {
  args: {
    host: pushing([launcher]),
    screen: undefined,
    screenOf: undefined,
    systemOf: undefined,
  },
};

export const Usb: Story = {
  args: {
    host: pushing([usb]),
    screen: undefined,
    screenOf: undefined,
    systemOf: undefined,
  },
};

export const Print: Story = {
  args: {
    host: pushing([print([officePrinter])]),
    screen: undefined,
    screenOf: undefined,
    systemOf: undefined,
  },
};

export const NoPrinters: Story = {
  args: {
    host: pushing([print([])]),
    screen: undefined,
    screenOf: undefined,
    systemOf: undefined,
  },
};

export const Capturing: Story = {
  args: {
    host: pushing(
      [],
      [
        { ...remoteDesktop, id: 6 },
        { ...inputCapture, id: 7 },
        {
          app_id: "us.zoom.Zoom",
          body: {
            sources: [
              { id: "app-3", title: "Notes", type: "window" },
              { name: "drm-1", type: "monitor" },
            ],
          },
          id: 8,
          kind: "screen_cast",
        },
      ],
    ),
    screen: undefined,
    screenOf: undefined,
    shellChords: undefined,
    systemOf: undefined,
  },
};

export const GlobalShortcuts: Story = {
  args: {
    host: pushing([globalShortcuts]),
    screen: undefined,
    screenOf: undefined,
    shellChords: ["Meta+Return"],
    systemOf: undefined,
  },
};

export const Wallpaper: Story = {
  args: {
    host: pushing([wallpaper]),
    screen: undefined,
    screenOf: undefined,
    systemOf: withPicture,
  },
};

export const Screenshot: Story = {
  args: {
    host: pushing([screenshot]),
    screen: undefined,
    screenOf: undefined,
    shellChords: undefined,
    systemOf: undefined,
  },
};

export const PickColor: Story = {
  args: {
    host: pushing([pickColor]),
    screen: undefined,
    screenOf: undefined,
    shellChords: undefined,
    systemOf: undefined,
  },
};
