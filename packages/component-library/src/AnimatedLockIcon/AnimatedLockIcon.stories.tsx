import type { Meta, StoryObj } from "@storybook/react-vite";

import { iconStage } from "../__test__/iconStage";
import { AnimatedLockIcon as AnimatedLockIconComponent } from "./AnimatedLockIcon";

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
  component: AnimatedLockIconComponent,
  decorators: [iconStage],
  parameters: {
    docs: {
      description: {
        component:
          "A lock whose shackle snaps shut when it appears and lifts while pointed at. Point at it, or remount the story.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Data Display/AnimatedLockIcon",
} satisfies Meta<typeof AnimatedLockIconComponent>;
export default meta;

export const Lock: StoryObj<typeof AnimatedLockIconComponent> = {
  args: {
    label: undefined,
    size: 48,
  },
};
