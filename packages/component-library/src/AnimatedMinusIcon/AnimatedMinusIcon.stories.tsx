import type { Meta, StoryObj } from "@storybook/react-vite";

import { iconStage } from "../__test__/iconStage";
import { AnimatedMinusIcon as AnimatedMinusIconComponent } from "./AnimatedMinusIcon";

const meta = {
  args: {
    label: undefined,
    size: 48,
  },
  argTypes: {
    label: { control: "text", table: { category: "Contents" } },
    size: {
      control: { min: 8, type: "number" },
      table: { category: "Appearance" },
    },
  },
  component: AnimatedMinusIconComponent,
  decorators: [iconStage],
  parameters: {
    docs: {
      description: {
        component:
          "A minus whose bar draws in while pointed at. Point at it to see its hover motion.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Data Display/AnimatedMinusIcon",
} satisfies Meta<typeof AnimatedMinusIconComponent>;
export default meta;

export const Minus: StoryObj<typeof AnimatedMinusIconComponent> = {
  args: {
    label: undefined,
    size: 48,
  },
};
