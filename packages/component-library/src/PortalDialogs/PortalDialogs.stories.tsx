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
  body: { reason: "Mail signs your messages with your name." },
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

export const Capturing: Story = {
  args: {
    host: pushing(
      [],
      [
        { ...remoteDesktop, id: 6 },
        { ...inputCapture, id: 7 },
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
