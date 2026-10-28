import type { Meta, StoryObj } from "@storybook/react-vite";

import { iconStage } from "../__test__/iconStage";
import { AnimatedCloseIcon as AnimatedCloseIconComponent } from "./AnimatedCloseIcon";

const meta = {
  args: {
    label: undefined,
    size: 48,
    weight: "regular",
  },
  argTypes: {
    label: { control: "text", table: { category: "Contents" } },
    size: {
      control: { min: 8, type: "number" },
      table: { category: "Appearance" },
    },
    weight: {
      control: "inline-radio",
      options: ["bold", "regular"],
      table: { category: "Appearance" },
    },
  },
  component: AnimatedCloseIconComponent,
  decorators: [iconStage],
  parameters: {
    docs: {
      description: {
        component:
          "An X whose strokes snip while pointed at. Point at it to see its hover motion.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Data Display/AnimatedCloseIcon",
} satisfies Meta<typeof AnimatedCloseIconComponent>;
export default meta;

export const Close: StoryObj<typeof AnimatedCloseIconComponent> = {
  args: {
    label: undefined,
    size: 48,
    weight: "regular",
  },
};

export const Bold: StoryObj<typeof AnimatedCloseIconComponent> = {
  args: {
    label: undefined,
    size: 48,
    weight: "bold",
  },
};
