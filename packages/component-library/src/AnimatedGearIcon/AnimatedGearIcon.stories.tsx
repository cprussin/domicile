import type { Meta, StoryObj } from "@storybook/react-vite";

import { iconStage } from "../__test__/iconStage";
import { AnimatedGearIcon as AnimatedGearIconComponent } from "./AnimatedGearIcon";

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
  component: AnimatedGearIconComponent,
  decorators: [iconStage],
  parameters: {
    docs: {
      description: {
        component:
          "A gear that turns one tooth while pointed at. Point at it to see its hover motion.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Data Display/AnimatedGearIcon",
} satisfies Meta<typeof AnimatedGearIconComponent>;
export default meta;

export const Gear: StoryObj<typeof AnimatedGearIconComponent> = {
  args: {
    label: undefined,
    size: 48,
  },
};
