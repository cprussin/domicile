import type { Meta, StoryObj } from "@storybook/react-vite";

import { iconStage } from "../__test__/iconStage";
import { AnimatedBellIcon as AnimatedBellIconComponent } from "./AnimatedBellIcon";

const meta = {
  args: {
    cue: 0,
    label: undefined,
    off: false,
    size: 48,
  },
  argTypes: {
    cue: { control: { min: 0, type: "number" }, table: { category: "State" } },
    label: { control: "text", table: { category: "Contents" } },
    off: { control: "boolean", table: { category: "State" } },
    size: {
      control: { min: 8, type: "number" },
      table: { category: "Appearance" },
    },
  },
  component: AnimatedBellIconComponent,
  decorators: [iconStage],
  parameters: {
    docs: {
      description: {
        component:
          "The bar's bell: it swings, its clapper lagging, on each new cue. Point at it to see its hover motion.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Data Display/AnimatedBellIcon",
} satisfies Meta<typeof AnimatedBellIconComponent>;
export default meta;

export const Bell: StoryObj<typeof AnimatedBellIconComponent> = {
  args: {
    cue: 0,
    label: undefined,
    off: false,
    size: 48,
  },
};

export const NewNotification: StoryObj<typeof AnimatedBellIconComponent> = {
  args: {
    cue: 1,
    label: undefined,
    off: false,
    size: 48,
  },
};

export const Off: StoryObj<typeof AnimatedBellIconComponent> = {
  args: {
    cue: 0,
    label: undefined,
    off: true,
    size: 48,
  },
};
