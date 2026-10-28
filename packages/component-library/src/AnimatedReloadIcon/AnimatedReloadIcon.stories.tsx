import type { Meta, StoryObj } from "@storybook/react-vite";

import { iconStage } from "../__test__/iconStage";
import { AnimatedReloadIcon as AnimatedReloadIconComponent } from "./AnimatedReloadIcon";

const meta = {
  args: {
    label: undefined,
    loading: false,
    size: 48,
  },
  argTypes: {
    label: { control: "text", table: { category: "Contents" } },
    loading: { control: "boolean", table: { category: "State" } },
    size: {
      control: { min: 8, type: "number" },
      table: { category: "Appearance" },
    },
  },
  component: AnimatedReloadIconComponent,
  decorators: [iconStage],
  parameters: {
    docs: {
      description: {
        component:
          "Reload or stop: an arrow that winds forward while pointed at, and spins into an X while `loading`. Point at it, or change `loading`.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Data Display/AnimatedReloadIcon",
} satisfies Meta<typeof AnimatedReloadIconComponent>;
export default meta;

export const Reload: StoryObj<typeof AnimatedReloadIconComponent> = {
  args: {
    label: undefined,
    loading: false,
    size: 48,
  },
};

export const Stop: StoryObj<typeof AnimatedReloadIconComponent> = {
  args: {
    label: undefined,
    loading: true,
    size: 48,
  },
};
