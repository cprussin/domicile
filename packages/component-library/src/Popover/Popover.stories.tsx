import { InfoIcon } from "@phosphor-icons/react/dist/ssr/Info";
import { LockIcon } from "@phosphor-icons/react/dist/ssr/Lock";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { Button } from "../Button/Button";
import { ALIGNMENTS, Popover as PopoverComponent, SIDES } from "./Popover";

const meta = {
  args: {
    align: "center",
    children:
      "The connection to this site is encrypted. Nothing else on the network can read what is sent.",
    side: "bottom",
    title: "Connection",
    trigger: <Button beforeIcon={<InfoIcon />}>Details</Button>,
  },
  argTypes: {
    align: {
      control: "inline-radio",
      options: ALIGNMENTS,
      table: { category: "Style" },
    },
    children: {
      control: "text",
      table: { category: "Contents" },
    },
    defaultOpen: {
      control: "boolean",
      table: { category: "State" },
    },
    flush: {
      control: "boolean",
      table: { category: "Style" },
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
    title: {
      control: "text",
      table: { category: "Contents" },
    },
    trigger: {
      control: false,
      table: { category: "Contents" },
    },
  },
  component: PopoverComponent,
  parameters: {
    docs: {
      description: {
        component:
          "A non-modal panel anchored to the control that opened it, wrapping the @base-ui/react Popover primitive. For detail a control has no room for — what an indicator means, what a value is made of. The page behind stays live; pressing outside or Escape closes it.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Overlays/Popover",
} satisfies Meta<typeof PopoverComponent>;
export default meta;

export const Popover: StoryObj<typeof PopoverComponent> = {
  args: {
    align: "center",
    defaultOpen: false,
    flush: false,
    side: "bottom",
  },
};

export const OpenByDefault = {
  args: {
    align: "center",
    defaultOpen: true,
    flush: false,
    side: "bottom",
  },
} satisfies StoryObj<typeof PopoverComponent>;

export const AlignedToAnIndicator = {
  args: {
    align: "start",
    defaultOpen: true,
    flush: false,
    side: "bottom",
    title: "Connection is encrypted",
    trigger: (
      <Button label="Connection" size="sm" variant="ghost">
        <LockIcon />
      </Button>
    ),
  },
  parameters: {
    docs: {
      description: {
        story:
          "What a browser's address bar does with it: a small icon-only trigger, and a panel whose inline start lines up with the icon.",
      },
    },
  },
} satisfies StoryObj<typeof PopoverComponent>;

export const WithoutATitle = {
  args: {
    align: "center",
    defaultOpen: true,
    flush: false,
    side: "top",
    title: undefined,
  },
} satisfies StoryObj<typeof PopoverComponent>;

export const Flush = {
  args: {
    align: "start",
    children: <iframe srcDoc="An extension's popup" title="Popup" />,
    defaultOpen: true,
    flush: true,
    side: "bottom",
    title: undefined,
  },
  parameters: {
    docs: {
      description: {
        story:
          "A body that is a page of its own, as an extension's popup is: no padding framing it, and its corners clipped to the panel's.",
      },
    },
  },
} satisfies StoryObj<typeof PopoverComponent>;
