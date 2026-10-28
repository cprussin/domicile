import type { Meta, StoryObj } from "@storybook/react-vite";

import { iconStage } from "../__test__/iconStage";
import { AnimatedEyeIcon as AnimatedEyeIconComponent } from "./AnimatedEyeIcon";

const meta = {
  args: {
    label: undefined,
    open: true,
    size: 48,
  },
  argTypes: {
    label: { control: "text", table: { category: "Contents" } },
    open: { control: "boolean", table: { category: "State" } },
    size: {
      control: { min: 8, type: "number" },
      table: { category: "Appearance" },
    },
  },
  component: AnimatedEyeIconComponent,
  decorators: [iconStage],
  parameters: {
    docs: {
      description: {
        component:
          "An eye that blinks shut, and looks around while pointed at. Point at it to see its hover motion.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Data Display/AnimatedEyeIcon",
} satisfies Meta<typeof AnimatedEyeIconComponent>;
export default meta;

export const Eye: StoryObj<typeof AnimatedEyeIconComponent> = {
  args: {
    label: undefined,
    open: true,
    size: 48,
  },
};

export const Shut: StoryObj<typeof AnimatedEyeIconComponent> = {
  args: {
    label: undefined,
    open: false,
    size: 48,
  },
};
