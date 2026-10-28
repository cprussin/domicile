import type { Meta, StoryObj } from "@storybook/react-vite";

import { iconStage } from "../__test__/iconStage";
import { AnimatedBluetoothIcon as AnimatedBluetoothIconComponent } from "./AnimatedBluetoothIcon";

const meta = {
  args: {
    label: undefined,
    size: 48,
    state: "connected",
  },
  argTypes: {
    label: { control: "text", table: { category: "Contents" } },
    size: {
      control: { min: 8, type: "number" },
      table: { category: "Appearance" },
    },
    state: {
      control: "inline-radio",
      options: ["connected", "on", "off"],
      table: { category: "State" },
    },
  },
  component: AnimatedBluetoothIconComponent,
  decorators: [iconStage],
  parameters: {
    docs: {
      description: {
        component:
          "Bluetooth: the dots slide out of the rune while a device is connected, and a slash draws across while off. Point at it to see its hover motion.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Data Display/AnimatedBluetoothIcon",
} satisfies Meta<typeof AnimatedBluetoothIconComponent>;
export default meta;

export const Bluetooth: StoryObj<typeof AnimatedBluetoothIconComponent> = {
  args: {
    label: undefined,
    size: 48,
    state: "connected",
  },
};

export const On: StoryObj<typeof AnimatedBluetoothIconComponent> = {
  args: {
    label: undefined,
    size: 48,
    state: "on",
  },
};

export const Off: StoryObj<typeof AnimatedBluetoothIconComponent> = {
  args: {
    label: undefined,
    size: 48,
    state: "off",
  },
};
