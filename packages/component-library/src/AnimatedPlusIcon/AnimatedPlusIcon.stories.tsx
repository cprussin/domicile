import type { Meta, StoryObj } from "@storybook/react-vite";

import { iconStage } from "../__test__/iconStage";
import { AnimatedPlusIcon as AnimatedPlusIconComponent } from "./AnimatedPlusIcon";

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
  component: AnimatedPlusIconComponent,
  decorators: [iconStage],
  parameters: {
    docs: {
      description: {
        component:
          "A plus whose arms reach out while pointed at. Point at it to see its hover motion.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Data Display/AnimatedPlusIcon",
} satisfies Meta<typeof AnimatedPlusIconComponent>;
export default meta;

export const Plus: StoryObj<typeof AnimatedPlusIconComponent> = {
  args: {
    label: undefined,
    size: 48,
    weight: "regular",
  },
};

export const Bold: StoryObj<typeof AnimatedPlusIconComponent> = {
  args: {
    label: undefined,
    size: 48,
    weight: "bold",
  },
};
