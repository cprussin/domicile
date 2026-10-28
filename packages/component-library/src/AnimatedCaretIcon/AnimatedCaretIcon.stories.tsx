import type { Meta, StoryObj } from "@storybook/react-vite";

import { iconStage } from "../__test__/iconStage";
import { AnimatedCaretIcon as AnimatedCaretIconComponent } from "./AnimatedCaretIcon";

const meta = {
  args: {
    label: undefined,
    pointing: "left",
    size: 48,
  },
  argTypes: {
    label: { control: "text", table: { category: "Contents" } },
    pointing: {
      control: "select",
      options: ["down", "left", "right", "up"],
      table: { category: "Appearance" },
    },
    size: {
      control: { min: 8, type: "number" },
      table: { category: "Appearance" },
    },
  },
  component: AnimatedCaretIconComponent,
  decorators: [iconStage],
  parameters: {
    docs: {
      description: {
        component:
          "A caret whose point sharpens and darts the way it points while pointed at. Point at it to see its hover motion.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Data Display/AnimatedCaretIcon",
} satisfies Meta<typeof AnimatedCaretIconComponent>;
export default meta;

export const Left: StoryObj<typeof AnimatedCaretIconComponent> = {
  args: {
    label: undefined,
    pointing: "left",
    size: 48,
  },
};

export const Right: StoryObj<typeof AnimatedCaretIconComponent> = {
  args: {
    label: undefined,
    pointing: "right",
    size: 48,
  },
};

export const Up: StoryObj<typeof AnimatedCaretIconComponent> = {
  args: {
    label: undefined,
    pointing: "up",
    size: 48,
  },
};

export const Down: StoryObj<typeof AnimatedCaretIconComponent> = {
  args: {
    label: undefined,
    pointing: "down",
    size: 48,
  },
};
