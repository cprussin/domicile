import type { Meta, StoryObj } from "@storybook/react-vite";

import { iconStage } from "../__test__/iconStage";
import { AnimatedLayoutIcon as AnimatedLayoutIconComponent } from "./AnimatedLayoutIcon";

const meta = {
  args: {
    label: undefined,
    layout: "row",
    size: 48,
  },
  argTypes: {
    label: { control: "text", table: { category: "Contents" } },
    layout: {
      control: "select",
      options: ["column", "row", "stack", "tabs"],
      table: { category: "State" },
    },
    size: {
      control: { min: 8, type: "number" },
      table: { category: "Appearance" },
    },
  },
  component: AnimatedLayoutIconComponent,
  decorators: [iconStage],
  parameters: {
    docs: {
      description: {
        component:
          "A group's layout; the new one builds in when it changes. Change `layout` to see it.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Data Display/AnimatedLayoutIcon",
} satisfies Meta<typeof AnimatedLayoutIconComponent>;
export default meta;

export const Row: StoryObj<typeof AnimatedLayoutIconComponent> = {
  args: {
    label: undefined,
    layout: "row",
    size: 48,
  },
};

export const Column: StoryObj<typeof AnimatedLayoutIconComponent> = {
  args: {
    label: undefined,
    layout: "column",
    size: 48,
  },
};

export const Stack: StoryObj<typeof AnimatedLayoutIconComponent> = {
  args: {
    label: undefined,
    layout: "stack",
    size: 48,
  },
};

export const Tabs: StoryObj<typeof AnimatedLayoutIconComponent> = {
  args: {
    label: undefined,
    layout: "tabs",
    size: 48,
  },
};
