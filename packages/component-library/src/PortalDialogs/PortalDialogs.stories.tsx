import type { PortalHost } from "@domicile-desktop/sdk/portal";
import type { SystemHost } from "@domicile-desktop/sdk/system";
import { fakeSystem } from "@domicile-desktop/system-apps/fake-system";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { PortalDialogs } from "./PortalDialogs";

/**
 * A desktop with one pending request. Answers go to the console; the request
 * stays up, since no compositor takes it away.
 */
const pending = (item: object): PortalHost & SystemHost => ({
  addEventListener: (type, listener) => {
    if (type === "portalrequests") {
      const data = JSON.stringify({ items: [item], type: "portal_requests" });
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

const meta = {
  args: { host: pending(access), screen: undefined, systemOf: undefined },
  argTypes: {
    host: {
      control: false,
      table: { category: "Behavior" },
    },
    screen: {
      control: "text",
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
  args: { host: pending(access), screen: undefined, systemOf: undefined },
};

export const AppChooser: Story = {
  args: { host: pending(appChooser), screen: undefined, systemOf: installed },
};
