import type { Meta, StoryObj } from "@storybook/react-vite";

import { iconStage } from "../__test__/iconStage";
import { AnimatedLightningIcon as AnimatedLightningIconComponent } from "./AnimatedLightningIcon";

const meta = {
  args: {
    label: undefined,
    size: 48,
    x: undefined,
    y: undefined,
  },
  argTypes: {
    label: { control: "text", table: { category: "Contents" } },
    size: {
      control: { min: 8, type: "number" },
      table: { category: "Appearance" },
    },
    x: { control: "number", table: { category: "Appearance" } },
    y: { control: "number", table: { category: "Appearance" } },
  },
  component: AnimatedLightningIconComponent,
  decorators: [iconStage],
  parameters: {
    docs: {
      description: {
        component:
          "A bolt that strikes down when it appears, such as when charging starts. Point at it to see its hover motion.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Data Display/AnimatedLightningIcon",
} satisfies Meta<typeof AnimatedLightningIconComponent>;
export default meta;

export const Lightning: StoryObj<typeof AnimatedLightningIconComponent> = {
  args: {
    label: undefined,
    size: 48,
    x: undefined,
    y: undefined,
  },
};
