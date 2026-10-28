import type { Meta, StoryObj } from "@storybook/react-vite";

import { iconStage } from "../__test__/iconStage";
import { AnimatedFloatIcon as AnimatedFloatIconComponent } from "./AnimatedFloatIcon";

const meta = {
  args: {
    floating: false,
    label: undefined,
    size: 48,
  },
  argTypes: {
    floating: { control: "boolean", table: { category: "State" } },
    label: { control: "text", table: { category: "Contents" } },
    size: {
      control: { min: 8, type: "number" },
      table: { category: "Appearance" },
    },
  },
  component: AnimatedFloatIconComponent,
  decorators: [iconStage],
  parameters: {
    docs: {
      description: {
        component:
          "Float or tile a window: two windows that lift apart while pointed at, which gather into four squares when the window floats. Point at it, or change `floating`.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Data Display/AnimatedFloatIcon",
} satisfies Meta<typeof AnimatedFloatIconComponent>;
export default meta;

export const Tiled: StoryObj<typeof AnimatedFloatIconComponent> = {
  args: {
    floating: false,
    label: undefined,
    size: 48,
  },
};

export const Floating: StoryObj<typeof AnimatedFloatIconComponent> = {
  args: {
    floating: true,
    label: undefined,
    size: 48,
  },
};
