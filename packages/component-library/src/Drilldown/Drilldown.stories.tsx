import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { css } from "../../styled-system/css";
import { Drilldown as DrilldownComponent } from "./Drilldown";

const meta = {
  args: {
    children: <p>The main view.</p>,
    detail: undefined,
    onBack: () => undefined,
  },
  argTypes: {
    children: {
      control: false,
      table: { category: "Contents" },
    },
    detail: {
      control: false,
      table: { category: "Contents" },
    },
    onBack: {
      action: "back",
      table: { category: "Events" },
    },
  },
  component: DrilldownComponent,
  decorators: [
    (Story) => (
      <div className={frameStyles}>
        <Story />
      </div>
    ),
  ],
  parameters: {
    docs: {
      description: {
        component:
          "A view that a detail slides in over from the side, with a back button to slide it out again — one level deeper without leaving the panel.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Navigation/Drilldown",
} satisfies Meta<typeof DrilldownComponent>;
export default meta;

export const Closed: StoryObj<typeof DrilldownComponent> = {
  args: {
    detail: undefined,
  },
};

export const Open: StoryObj<typeof DrilldownComponent> = {
  args: {
    detail: {
      content: <p>Speakers · Headphones · Line out</p>,
      title: "Port",
    },
  },
};

/** Press the row to drill in, and back to come out. */
export const Interactive: StoryObj<typeof DrilldownComponent> = {
  render: () => <Interactively />,
};

const Interactively = () => {
  const [open, setOpen] = useState(false);
  return (
    <DrilldownComponent
      detail={
        open
          ? { content: <p>Speakers · Headphones · Line out</p>, title: "Port" }
          : undefined
      }
      onBack={() => {
        setOpen(false);
      }}
    >
      <button
        onClick={() => {
          setOpen(true);
        }}
        type="button"
      >
        Port: Speakers ›
      </button>
    </DrilldownComponent>
  );
};

const frameStyles = css({ inlineSize: 72 });
