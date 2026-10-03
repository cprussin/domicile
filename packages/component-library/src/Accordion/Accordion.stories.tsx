import type { Meta, StoryObj } from "@storybook/react-vite";

import { css } from "../../styled-system/css";
import type { AccordionItem } from "./Accordion";
import { Accordion as AccordionComponent } from "./Accordion";

const ITEMS: readonly AccordionItem[] = [
  {
    content: <p>Speakers, headphones and the HDMI output.</p>,
    label: "Outputs",
    value: "outputs",
  },
  {
    content: <p>The built-in microphone and a headset.</p>,
    label: "Inputs",
    value: "inputs",
  },
  {
    content: <p>Nothing here — this section is disabled.</p>,
    disabled: true,
    label: "Cards",
    value: "cards",
  },
];

const meta = {
  args: {
    defaultValue: [],
    items: ITEMS,
    multiple: false,
  },
  argTypes: {
    defaultValue: {
      control: "check",
      options: ITEMS.map((item) => item.value),
      table: { category: "State" },
    },
    items: {
      control: false,
      table: { category: "Contents" },
    },
    multiple: {
      control: "boolean",
      table: { category: "Behavior" },
    },
    onValueChange: {
      action: "valueChange",
      table: { category: "Events" },
    },
    value: {
      control: false,
      table: { category: "State" },
    },
  },
  component: AccordionComponent,
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
          "Sections stacked under their labels, each opening in place with a turning caret and a panel that grows to its content. Wraps the @base-ui/react Accordion primitive, and draws in the color of its container.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Layout/Accordion",
} satisfies Meta<typeof AccordionComponent>;
export default meta;

export const Accordion: StoryObj<typeof AccordionComponent> = {
  args: {
    defaultValue: ["outputs"],
    multiple: false,
  },
};

export const Multiple: StoryObj<typeof AccordionComponent> = {
  args: {
    defaultValue: ["outputs", "inputs"],
    multiple: true,
  },
};

const frameStyles = css({ inlineSize: 72 });
