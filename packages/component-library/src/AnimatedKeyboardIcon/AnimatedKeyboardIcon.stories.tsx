import type { Meta, StoryObj } from "@storybook/react-vite";

import { iconStage } from "../__test__/iconStage";
import { AnimatedKeyboardIcon as AnimatedKeyboardIconComponent } from "./AnimatedKeyboardIcon";

const meta = {
  args: {
    cue: 0,
    label: undefined,
    size: 48,
  },
  argTypes: {
    cue: { control: { min: 0, type: "number" }, table: { category: "State" } },
    label: { control: "text", table: { category: "Contents" } },
    size: {
      control: { min: 8, type: "number" },
      table: { category: "Appearance" },
    },
  },
  component: AnimatedKeyboardIconComponent,
  decorators: [iconStage],
  parameters: {
    docs: {
      description: {
        component:
          "A keyboard whose keys press in a wave on each new cue, such as a keymap change. Point at it to see its hover motion.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Data Display/AnimatedKeyboardIcon",
} satisfies Meta<typeof AnimatedKeyboardIconComponent>;
export default meta;

export const Keyboard: StoryObj<typeof AnimatedKeyboardIconComponent> = {
  args: {
    cue: 0,
    label: undefined,
    size: 48,
  },
};
