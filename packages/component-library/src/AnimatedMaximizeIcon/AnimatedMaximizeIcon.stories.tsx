import type { Meta, StoryObj } from "@storybook/react-vite";

import { iconStage } from "../__test__/iconStage";
import { AnimatedMaximizeIcon as AnimatedMaximizeIconComponent } from "./AnimatedMaximizeIcon";

const meta = {
  args: {
    label: undefined,
    maximized: false,
    size: 48,
  },
  argTypes: {
    label: { control: "text", table: { category: "Contents" } },
    maximized: { control: "boolean", table: { category: "State" } },
    size: {
      control: { min: 8, type: "number" },
      table: { category: "Appearance" },
    },
  },
  component: AnimatedMaximizeIconComponent,
  decorators: [iconStage],
  parameters: {
    docs: {
      description: {
        component:
          "Maximize or restore a window: corners that push out, or pull in once maximized, and travel into each other on a change. Point at it, or change `maximized`.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Data Display/AnimatedMaximizeIcon",
} satisfies Meta<typeof AnimatedMaximizeIconComponent>;
export default meta;

export const NotMaximized: StoryObj<typeof AnimatedMaximizeIconComponent> = {
  args: {
    label: undefined,
    maximized: false,
    size: 48,
  },
};

export const Maximized: StoryObj<typeof AnimatedMaximizeIconComponent> = {
  args: {
    label: undefined,
    maximized: true,
    size: 48,
  },
};
