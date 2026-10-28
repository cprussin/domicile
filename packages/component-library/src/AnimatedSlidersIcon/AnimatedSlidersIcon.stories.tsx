import type { Meta, StoryObj } from "@storybook/react-vite";

import { iconStage } from "../__test__/iconStage";
import { AnimatedSlidersIcon as AnimatedSlidersIconComponent } from "./AnimatedSlidersIcon";

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
  component: AnimatedSlidersIconComponent,
  decorators: [iconStage],
  parameters: {
    docs: {
      description: {
        component:
          "Sliders whose knobs slide opposite ways while pointed at. Point at it to see its hover motion.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Data Display/AnimatedSlidersIcon",
} satisfies Meta<typeof AnimatedSlidersIconComponent>;
export default meta;

export const Sliders: StoryObj<typeof AnimatedSlidersIconComponent> = {
  args: {
    label: undefined,
    size: 48,
  },
};
