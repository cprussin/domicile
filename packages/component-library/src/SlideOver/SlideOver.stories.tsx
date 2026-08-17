import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "../Button/Button";

import { SlideOver } from "./SlideOver";

const meta = {
  args: {
    defaultOpen: false,
  },
  argTypes: {
    children: {
      control: "text",
      table: { category: "Contents" },
    },
    defaultOpen: {
      control: "boolean",
      table: { category: "State" },
    },
    footer: {
      table: { category: "Contents" },
    },
    onOpenChange: {
      table: { category: "Behavior" },
    },
    open: {
      control: "boolean",
      table: { category: "State" },
    },
    title: {
      control: "text",
      table: { category: "Contents" },
    },
    trigger: {
      table: { category: "Contents" },
    },
  },
  component: SlideOver,
  parameters: {
    docs: {
      description: {
        component:
          "A panel that slides in from the right edge and holds full-height content — the companion to ModalDialog for content that belongs alongside the page rather than centered over it. Same @base-ui/react Dialog semantics and the same trigger / title / children / footer API.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Overlays/SlideOver",
} satisfies Meta<typeof SlideOver>;
export default meta;

export const Transcript: StoryObj<typeof SlideOver> = {
  args: {
    children:
      "The conversation transcript lives here, alongside the page rather than over it.",
    title: "Transcript",
    trigger: <Button size="xl">Open transcript</Button>,
  },
};

export const WithFooter: StoryObj<typeof SlideOver> = {
  args: {
    children: "A details pane with actions pinned to the foot.",
    footer: (
      <>
        <SlideOver.Close render={<Button variant="ghost">Dismiss</Button>} />
        <Button variant="solid">Apply</Button>
      </>
    ),
    title: "Details",
    trigger: <Button size="xl">Open</Button>,
  },
};

export const Scrolling: StoryObj<typeof SlideOver> = {
  args: {
    children: (
      <>
        {Array.from({ length: 25 }, (_, i) => (
          <p key={i}>
            Message {i + 1}. Lorem ipsum dolor sit amet, consectetur adipiscing
            elit. Sed do eiusmod tempor incididunt ut labore et dolore magna
            aliqua.
          </p>
        ))}
      </>
    ),
    title: "Long transcript",
    trigger: <Button size="xl">Open</Button>,
  },
};
