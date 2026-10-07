import type { PortalHost } from "@domicile-desktop/sdk/portal";
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
): PortalHost & SystemHost => ({
  addEventListener: (type, listener) => {
    if (type === "portalrequests") {
      const data = JSON.stringify({
        capturing,
        items,
        type: "portal_requests",
      });
      listener(new MessageEvent("portalrequests", { data }));
    }
  },
  answerPortalRequest: (id, answer) => {
    // biome-ignore lint/suspicious/noConsole: the story shows its answers in the console
    console.info("answered", id, answer);
  },
  callSystem: () => undefined,
  removeEventListener: () => undefined,
});

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

const meta = {
  args: {
    host: pushing([access]),
    screen: undefined,
    screenOf: undefined,
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
    systemOf: undefined,
  },
};

export const AppChooser: Story = {
  args: {
    host: pushing([appChooser]),
    screen: undefined,
    screenOf: undefined,
    systemOf: installed,
  },
};

export const FileChooser: Story = {
  args: {
    host: pushing([fileChooser]),
    screen: undefined,
    screenOf: undefined,
    systemOf: home,
  },
};

export const RemoteDesktop: Story = {
  args: {
    host: pushing([remoteDesktop]),
    screen: undefined,
    screenOf: undefined,
    systemOf: undefined,
  },
};

export const InputCapture: Story = {
  args: {
    host: pushing([inputCapture]),
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
    systemOf: undefined,
  },
};
