import { BluetoothIcon } from "@phosphor-icons/react/dist/ssr/Bluetooth";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { Button } from "../Button/Button";
import { ALIGNMENTS, SIDES, TONES } from "../Popover/Popover";
import { Tooltip as TooltipComponent } from "./Tooltip";

const meta = {
  args: {
    align: "center",
    content: "Rust Programming Language — A language empowering everyone",
    delay: undefined,
    side: "bottom",
    tone: "card",
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
    tone: {
      control: "inline-radio",
      options: TONES,
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
    tone: "card",
  },
};

export const OpenByDefault = {
  args: {
    align: "center",
    defaultOpen: true,
    delay: undefined,
    side: "bottom",
    tone: "card",
  },
} satisfies StoryObj<typeof TooltipComponent>;

export const OverPhoto = {
  args: {
    align: "center",
    content: "Bluetooth: WH-1000XM4 (80%)",
    defaultOpen: true,
    delay: undefined,
    side: "bottom",
    tone: "overPhoto",
    trigger: (
      <Button label="Bluetooth" size="sm" variant="ghost">
        <BluetoothIcon weight="bold" />
      </Button>
    ),
  },
  parameters: {
    docs: {
      description: {
        story:
          "A pill under an item on a bar drawn onto the wallpaper, matching the bar's panels.",
      },
    },
  },
} satisfies StoryObj<typeof TooltipComponent>;
