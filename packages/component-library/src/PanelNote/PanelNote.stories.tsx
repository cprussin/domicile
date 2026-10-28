import type { Meta, StoryObj } from "@storybook/react-vite";

import { PanelNote as PanelNoteComponent, TONES } from "./PanelNote";

const meta = {
  args: {
    children: "Searching for devices…",
    tone: "quiet",
  },
  argTypes: {
    children: { control: "text", table: { category: "Contents" } },
    detail: { control: "text", table: { category: "Contents" } },
    tone: {
      control: "inline-radio",
      options: TONES,
      table: { category: "Appearance" },
    },
  },
  component: PanelNoteComponent,
  parameters: {
    docs: {
      description: {
        component:
          "One line on how a panel stands: searching, off, empty, or a request that failed, in plain words with the service's in its tooltip.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Panels/PanelNote",
} satisfies Meta<typeof PanelNoteComponent>;
export default meta;

export const Quiet: StoryObj<typeof PanelNoteComponent> = {};

export const Warning: StoryObj<typeof PanelNoteComponent> = {
  args: {
    children: "Couldn't look for networks",
    detail: "net.connman.iwd.NotSupported: Operation not supported",
    tone: "warning",
  },
};
