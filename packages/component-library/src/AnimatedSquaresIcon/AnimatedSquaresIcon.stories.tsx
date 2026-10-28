import type { Meta, StoryObj } from "@storybook/react-vite";

import { iconStage } from "../__test__/iconStage";
import { AnimatedSquaresIcon as AnimatedSquaresIconComponent } from "./AnimatedSquaresIcon";

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
  component: AnimatedSquaresIconComponent,
  decorators: [iconStage],
  parameters: {
    docs: {
      description: {
        component:
          "Four squares that part while pointed at and close in while pressed. Point at it to see its hover motion.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Data Display/AnimatedSquaresIcon",
} satisfies Meta<typeof AnimatedSquaresIconComponent>;
export default meta;

export const Squares: StoryObj<typeof AnimatedSquaresIconComponent> = {
  args: {
    label: undefined,
    size: 48,
  },
};
