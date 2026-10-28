import type { Meta, StoryObj } from "@storybook/react-vite";

import { iconStage } from "../__test__/iconStage";
import { AnimatedMicrophoneIcon as AnimatedMicrophoneIconComponent } from "./AnimatedMicrophoneIcon";

const meta = {
  args: {
    label: undefined,
    muted: false,
    size: 48,
    weight: "regular",
  },
  argTypes: {
    label: { control: "text", table: { category: "Contents" } },
    muted: { control: "boolean", table: { category: "State" } },
    size: {
      control: { min: 8, type: "number" },
      table: { category: "Appearance" },
    },
    weight: {
      control: "inline-radio",
      options: ["fill", "regular"],
      table: { category: "Appearance" },
    },
  },
  component: AnimatedMicrophoneIconComponent,
  decorators: [iconStage],
  parameters: {
    docs: {
      description: {
        component:
          "A microphone: a slash while muted, and a bob of the capsule when unmuted. Point at it to see its hover motion.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Data Display/AnimatedMicrophoneIcon",
} satisfies Meta<typeof AnimatedMicrophoneIconComponent>;
export default meta;

export const Microphone: StoryObj<typeof AnimatedMicrophoneIconComponent> = {
  args: {
    label: undefined,
    muted: false,
    size: 48,
    weight: "regular",
  },
};

export const Muted: StoryObj<typeof AnimatedMicrophoneIconComponent> = {
  args: {
    label: undefined,
    muted: true,
    size: 48,
    weight: "regular",
  },
};
