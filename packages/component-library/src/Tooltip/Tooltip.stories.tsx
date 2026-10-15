import type { Meta, StoryObj } from "@storybook/react-vite";

import { Button } from "../Button/Button";
import { ALIGNMENTS, SIDES } from "../Popover/Popover";
import { Tooltip as TooltipComponent } from "./Tooltip";

const meta = {
  args: {
    align: "center",
    content: "Rust Programming Language — A language empowering everyone",
    delay: undefined,
    side: "bottom",
    trigger: <Button>Rust Programming…</Button>,
  },
  argTypes: {
    align: {
      control: "inline-radio",
      options: ALIGNMENTS,
      table: { category: "Style" },
    },
    content: {
      control: "text",
      table: { category: "Contents" },
    },
    defaultOpen: {
      control: "boolean",
      table: { category: "State" },
    },
    delay: {
      control: "number",
      table: { category: "Behavior" },
    },
    open: {
      control: "boolean",
      table: { category: "State" },
    },
    side: {
      control: "inline-radio",
      options: SIDES,
      table: { category: "Style" },
    },
    trigger: {
      control: false,
      table: { category: "Contents" },
    },
  },
  component: TooltipComponent,
  parameters: {
    docs: {
      description: {
        component:
          "A short label shown while the pointer rests on its trigger, wrapping the @base-ui/react Tooltip primitive. For detail the trigger has no room for, such as a cut title.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Overlays/Tooltip",
} satisfies Meta<typeof TooltipComponent>;
export default meta;

export const Tooltip: StoryObj<typeof TooltipComponent> = {
  args: {
    align: "center",
    defaultOpen: false,
    delay: undefined,
    side: "bottom",
  },
};

export const OpenByDefault = {
  args: {
    align: "center",
    defaultOpen: true,
    delay: undefined,
    side: "bottom",
  },
} satisfies StoryObj<typeof TooltipComponent>;
