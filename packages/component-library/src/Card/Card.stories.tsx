import type { Meta, StoryObj } from "@storybook/react-vite";

import { Card as CardComponent } from "./Card";

const meta = {
  args: {
    children: "Panel contents go here.",
    title: "Settings",
  },
  argTypes: {
    children: {
      control: "text",
      table: { category: "Contents" },
    },
    title: {
      control: "text",
      table: { category: "Contents" },
    },
  },
  component: CardComponent,
  parameters: {
    docs: {
      description: {
        component:
          "A padded, bordered surface that stacks its children vertically, with an optional heading. The base building block for the app's chrome panels.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Layout/Card",
} satisfies Meta<typeof CardComponent>;
export default meta;

export const Card: StoryObj<typeof CardComponent> = {};

export const WithoutTitle: StoryObj<typeof CardComponent> = {
  args: {
    title: undefined,
  },
};

export const StackedContents: StoryObj<typeof CardComponent> = {
  parameters: {
    controls: { exclude: ["children"] },
    docs: {
      description: {
        story:
          "Multiple children stack vertically with the card's own gap — the panel frames whatever is composed into it.",
      },
    },
  },
  render: ({ title }) => (
    <CardComponent title={title}>
      <span>First row</span>
      <span>Second row</span>
      <span>Third row</span>
    </CardComponent>
  ),
};
