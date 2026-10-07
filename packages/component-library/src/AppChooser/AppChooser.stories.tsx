import { fakeSystem } from "@domicile-desktop/system-apps/fake-system";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { AppChooser as AppChooserComponent } from "./AppChooser";

const entry = (name: string): string =>
  `[Desktop Entry]\nType=Application\nName=${name}\nExec=true\n`;

/** Two installed applications; the browser is the default for PDFs. */
const installed = fakeSystem(
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
  args: {
    onCancel: () => {
      /* no-op */
    },
    onChoose: () => {
      /* no-op */
    },
  },
  argTypes: {
    choices: { control: "object", table: { category: "Contents" } },
    contentType: { control: "text", table: { category: "Contents" } },
    description: { control: "text", table: { category: "Contents" } },
    lastChoice: { control: "text", table: { category: "Behavior" } },
    onCancel: { control: false, table: { category: "Events" } },
    onChoose: { control: false, table: { category: "Events" } },
    screen: { control: "text", table: { category: "Behavior" } },
    system: { control: false, table: { category: "Behavior" } },
    title: { control: "text", table: { category: "Contents" } },
  },
  component: AppChooserComponent,
  parameters: {
    docs: {
      description: {
        component:
          "A dialog that picks an application to open a file or URI with, read from the desktop entries `system` reaches. The last choice, else the type's default, starts picked.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Overlays/AppChooser",
} satisfies Meta<typeof AppChooserComponent>;
export default meta;

type Story = StoryObj<typeof AppChooserComponent>;

export const Default: Story = {
  args: {
    choices: ["org.gnome.Evince", "firefox", "org.example.Unknown"],
    contentType: "application/pdf",
    description: undefined,
    lastChoice: undefined,
    screen: undefined,
    system: installed,
    title: "Open invoice.pdf with",
  },
};

export const Asked: Story = {
  args: {
    ...Default.args,
    description: "Mail asks",
    lastChoice: "org.gnome.Evince",
  },
};
