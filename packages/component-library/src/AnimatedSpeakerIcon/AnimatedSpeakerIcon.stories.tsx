import type { Meta, StoryObj } from "@storybook/react-vite";

import { iconStage } from "../__test__/iconStage";
import { AnimatedSpeakerIcon as AnimatedSpeakerIconComponent } from "./AnimatedSpeakerIcon";

const meta = {
  args: {
    label: undefined,
    muted: false,
    size: 48,
    volume: 0.8,
    weight: "bold",
  },
  argTypes: {
    label: { control: "text", table: { category: "Contents" } },
    muted: { control: "boolean", table: { category: "State" } },
    size: {
      control: { min: 8, type: "number" },
      table: { category: "Appearance" },
    },
    volume: {
      control: { max: 1, min: 0, step: 0.05, type: "range" },
      table: { category: "State" },
    },
    weight: {
      control: "inline-radio",
      options: ["bold", "fill", "regular"],
      table: { category: "Appearance" },
    },
  },
  component: AnimatedSpeakerIconComponent,
  decorators: [iconStage],
  parameters: {
    docs: {
      description: {
        component:
          "A speaker: a wave for each step of volume, pulsing as it changes, and a slash while muted. Point at it to see its hover motion.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Data Display/AnimatedSpeakerIcon",
} satisfies Meta<typeof AnimatedSpeakerIconComponent>;
export default meta;

export const Speaker: StoryObj<typeof AnimatedSpeakerIconComponent> = {
  args: {
    label: undefined,
    muted: false,
    size: 48,
    volume: 0.8,
    weight: "bold",
  },
};

export const Muted: StoryObj<typeof AnimatedSpeakerIconComponent> = {
  args: {
    label: undefined,
    muted: true,
    size: 48,
    volume: 0.8,
    weight: "bold",
  },
};
