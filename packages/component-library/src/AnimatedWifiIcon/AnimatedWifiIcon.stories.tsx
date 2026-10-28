import type { Meta, StoryObj } from "@storybook/react-vite";

import { iconStage } from "../__test__/iconStage";
import { AnimatedWifiIcon as AnimatedWifiIconComponent } from "./AnimatedWifiIcon";

const meta = {
  args: {
    bars: 3,
    connecting: false,
    label: undefined,
    off: false,
    size: 48,
  },
  argTypes: {
    bars: {
      control: "inline-radio",
      options: [1, 2, 3],
      table: { category: "State" },
    },
    connecting: { control: "boolean", table: { category: "State" } },
    label: { control: "text", table: { category: "Contents" } },
    off: { control: "boolean", table: { category: "State" } },
    size: {
      control: { min: 8, type: "number" },
      table: { category: "Appearance" },
    },
  },
  component: AnimatedWifiIconComponent,
  decorators: [iconStage],
  parameters: {
    docs: {
      description: {
        component:
          "Wi-Fi strength: arcs fill outward as the signal grows, pulse while connecting, and a slash draws across while off. Point at it to see its hover motion.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Data Display/AnimatedWifiIcon",
} satisfies Meta<typeof AnimatedWifiIconComponent>;
export default meta;

export const Wifi: StoryObj<typeof AnimatedWifiIconComponent> = {
  args: {
    bars: 3,
    connecting: false,
    label: undefined,
    off: false,
    size: 48,
  },
};

export const Connecting: StoryObj<typeof AnimatedWifiIconComponent> = {
  args: {
    bars: 3,
    connecting: true,
    label: undefined,
    off: false,
    size: 48,
  },
};

export const Off: StoryObj<typeof AnimatedWifiIconComponent> = {
  args: {
    bars: 3,
    connecting: false,
    label: undefined,
    off: true,
    size: 48,
  },
};
