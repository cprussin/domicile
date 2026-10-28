import type { Meta, StoryObj } from "@storybook/react-vite";

import { iconStage } from "../__test__/iconStage";
import { AnimatedDownloadIcon as AnimatedDownloadIconComponent } from "./AnimatedDownloadIcon";

const meta = {
  args: {
    cue: 0,
    label: undefined,
    size: 48,
  },
  argTypes: {
    cue: { control: { min: 0, type: "number" }, table: { category: "State" } },
    label: { control: "text", table: { category: "Contents" } },
    size: {
      control: { min: 8, type: "number" },
      table: { category: "Appearance" },
    },
  },
  component: AnimatedDownloadIconComponent,
  decorators: [iconStage],
  parameters: {
    docs: {
      description: {
        component:
          "A download whose arrow drops into its tray when it appears and on each new cue. Change `cue` to see it.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Data Display/AnimatedDownloadIcon",
} satisfies Meta<typeof AnimatedDownloadIconComponent>;
export default meta;

export const Download: StoryObj<typeof AnimatedDownloadIconComponent> = {
  args: {
    cue: 0,
    label: undefined,
    size: 48,
  },
};
