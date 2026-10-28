import type { Meta, StoryObj } from "@storybook/react-vite";

import { iconStage } from "../__test__/iconStage";
import { AnimatedCheckIcon as AnimatedCheckIconComponent } from "./AnimatedCheckIcon";

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
  component: AnimatedCheckIconComponent,
  decorators: [iconStage],
  parameters: {
    docs: {
      description: {
        component:
          "A check that draws in when it appears, such as when something has finished. Point at it to see its hover motion.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Data Display/AnimatedCheckIcon",
} satisfies Meta<typeof AnimatedCheckIconComponent>;
export default meta;

export const Check: StoryObj<typeof AnimatedCheckIconComponent> = {
  args: {
    label: undefined,
    size: 48,
  },
};
