import type { Meta, StoryObj } from "@storybook/react-vite";

import { iconStage } from "../__test__/iconStage";
import { AnimatedThemeIcon as AnimatedThemeIconComponent } from "./AnimatedThemeIcon";

const meta = {
  args: {
    dark: true,
    label: undefined,
    size: 48,
    weight: "bold",
  },
  argTypes: {
    dark: { control: "boolean", table: { category: "State" } },
    label: { control: "text", table: { category: "Contents" } },
    size: {
      control: { min: 8, type: "number" },
      table: { category: "Appearance" },
    },
    weight: {
      control: "inline-radio",
      options: ["bold", "fill"],
      table: { category: "Appearance" },
    },
  },
  component: AnimatedThemeIconComponent,
  decorators: [iconStage],
  parameters: {
    docs: {
      description: {
        component:
          "The theme: the sun's rays fold in and the moon turns into place going dark, and back going light. Point at it to see its hover motion.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Data Display/AnimatedThemeIcon",
} satisfies Meta<typeof AnimatedThemeIconComponent>;
export default meta;

export const Theme: StoryObj<typeof AnimatedThemeIconComponent> = {
  args: {
    dark: true,
    label: undefined,
    size: 48,
    weight: "bold",
  },
};

export const Light: StoryObj<typeof AnimatedThemeIconComponent> = {
  args: {
    dark: false,
    label: undefined,
    size: 48,
    weight: "bold",
  },
};
