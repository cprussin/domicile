import { fakeSystem } from "@domicile-desktop/system-apps/fake-system";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { AppChooser as AppChooserComponent } from "./AppChooser";

const entry = (name: string, icon = ""): string =>
  `[Desktop Entry]\nType=Application\nName=${name}\nExec=true\nIcon=${icon}\n`;

/** An orange circle, as an application's icon. */
const ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><circle cx="24" cy="24" r="22" fill="#d97757"/></svg>';

/**
 * Two installed applications, the browser with an icon; the browser is the
 * default for PDFs.
 */
const installed = fakeSystem(
  {
    "/config/mimeapps.list":
      "[Default Applications]\napplication/pdf=firefox.desktop\n",
    "/share/applications/firefox.desktop": entry("Firefox", "firefox"),
    "/share/applications/org.gnome.Evince.desktop": entry("Document Viewer"),
    "/share/icons/hicolor/48x48/apps/firefox.svg": ICON,
  },
  () => ({
    code: 0,
    stderr: "",
    stdout: "XDG_CONFIG_HOME=/config\0XDG_DATA_DIRS=/share\0",
  }),
);

const meta = {
  args: {
    onCancel: () => {
      /* no-op */
    },
    onChoose: () => {
      /* no-op */
    },
  },
  argTypes: {
    address: { control: "text", table: { category: "Contents" } },
    asker: { control: "text", table: { category: "Contents" } },
    choices: { control: "object", table: { category: "Contents" } },
    contentType: { control: "text", table: { category: "Contents" } },
    lastChoice: { control: "text", table: { category: "Behavior" } },
    onCancel: { control: false, table: { category: "Events" } },
    onChoose: { control: false, table: { category: "Events" } },
    opened: { control: "text", table: { category: "Contents" } },
    screen: { control: "text", table: { category: "Behavior" } },
    system: { control: false, table: { category: "Behavior" } },
  },
  component: AppChooserComponent,
  parameters: {
    docs: {
      description: {
        component:
          "A dialog that picks an application to open a file or URI with, read from the desktop entries `system` reaches. With one application and an asker, it asks whether to open that one.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Overlays/AppChooser",
} satisfies Meta<typeof AppChooserComponent>;
export default meta;

type Story = StoryObj<typeof AppChooserComponent>;

/** The user asked to choose: every application is listed. */
export const Default: Story = {
  args: {
    address: undefined,
    asker: undefined,
    choices: ["org.gnome.Evince", "firefox", "org.example.Unknown"],
    contentType: "application/pdf",
    lastChoice: undefined,
    opened: "invoice.pdf",
    screen: undefined,
    system: installed,
  },
};

/** An application asks, with several to choose from. */
export const Asked: Story = {
  args: {
    ...Default.args,
    asker: "Mail",
    lastChoice: "org.gnome.Evince",
  },
};

const signInLink = `claude://claude.ai/magic-link?anon_id=${"0123456789abcdef".repeat(4)}`;

/** An application asks to open a link only one application opens. */
export const OneApplication: Story = {
  args: {
    ...Default.args,
    address: signInLink,
    asker: "Chromium",
    choices: ["firefox"],
    contentType: "x-scheme-handler/claude",
    opened: "this link",
  },
};

/** A link no installed application opens. */
export const NoApplication: Story = {
  args: {
    ...OneApplication.args,
    choices: [],
  },
};
