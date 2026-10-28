import type { Meta, StoryObj } from "@storybook/react-vite";

import { iconStage } from "../__test__/iconStage";
import { AnimatedChatIcon as AnimatedChatIconComponent } from "./AnimatedChatIcon";

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
  component: AnimatedChatIconComponent,
  decorators: [iconStage],
  parameters: {
    docs: {
      description: {
        component:
          "A chat bubble that tips and writes its lines in on each new cue. Point at it to see its hover motion.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Data Display/AnimatedChatIcon",
} satisfies Meta<typeof AnimatedChatIconComponent>;
export default meta;

export const Chat: StoryObj<typeof AnimatedChatIconComponent> = {
  args: {
    cue: 0,
    label: undefined,
    size: 48,
  },
};

export const NewMessage: StoryObj<typeof AnimatedChatIconComponent> = {
  args: {
    cue: 1,
    label: undefined,
    size: 48,
  },
};
