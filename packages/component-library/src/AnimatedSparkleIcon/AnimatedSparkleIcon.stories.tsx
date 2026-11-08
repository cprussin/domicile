import type { Meta, StoryObj } from "@storybook/react-vite";

import { iconStage } from "../__test__/iconStage";
import { AnimatedSparkleIcon as AnimatedSparkleIconComponent } from "./AnimatedSparkleIcon";

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
  component: AnimatedSparkleIconComponent,
  decorators: [iconStage],
  parameters: {
    docs: {
      description: {
        component:
          "A sparkle whose star twists and glints wink while pointed at. Point at it to see its hover motion.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Data Display/AnimatedSparkleIcon",
} satisfies Meta<typeof AnimatedSparkleIconComponent>;
export default meta;

export const Sparkle: StoryObj<typeof AnimatedSparkleIconComponent> = {
  args: {
    label: undefined,
    size: 48,
  },
};
