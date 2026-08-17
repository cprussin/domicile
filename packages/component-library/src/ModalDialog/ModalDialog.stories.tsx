import type { Meta, StoryObj } from "@storybook/react-vite";
import { useMemo } from "react";
import { hstack } from "../../styled-system/patterns";
import { Button } from "../Button/Button";

import { createHandle, ModalDialog } from "./ModalDialog";

const meta = {
  args: {
    defaultOpen: false,
    disablePointerDismissal: false,
    modal: true,
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
    disablePointerDismissal: {
      control: "boolean",
      table: { category: "Behavior" },
    },
    footer: {
      table: { category: "Contents" },
    },
    modal: {
      control: "boolean",
      table: { category: "Behavior" },
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
  component: ModalDialog,
  parameters: {
    docs: {
      description: {
        component:
          "A modal dialog with an optional title, footer, and trigger. Wraps the @base-ui/react Dialog primitive and always renders a portal, backdrop, popup, body, and a header with a close button.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Overlays/ModalDialog",
} satisfies Meta<typeof ModalDialog>;
export default meta;

export const Settings: StoryObj<typeof ModalDialog> = {
  args: {
    children: "Configure your preferences here.",
    defaultOpen: false,
    disablePointerDismissal: false,
    footer: (
      <>
        <ModalDialog.CloseButton variant="ghost">
          Cancel
        </ModalDialog.CloseButton>
        <Button variant="solid">Save</Button>
      </>
    ),
    modal: true,
    title: "Settings",
    trigger: <Button size="xl">Click Me</Button>,
  },
};

export const NoTitle: StoryObj<typeof ModalDialog> = {
  args: {
    children: "This dialog has no title, but still shows a close button.",
    defaultOpen: false,
    disablePointerDismissal: false,
    footer: (
      <>
        <ModalDialog.CloseButton variant="ghost">
          Cancel
        </ModalDialog.CloseButton>
        <Button variant="solid">Confirm</Button>
      </>
    ),
    modal: true,
    trigger: <Button size="xl">Open</Button>,
  },
};

export const NoTitleOrFooter: StoryObj<typeof ModalDialog> = {
  args: {
    children:
      "This dialog has no title and no footer — just body content and a close button.",
    defaultOpen: false,
    disablePointerDismissal: false,
    modal: true,
    trigger: <Button size="xl">Open</Button>,
  },
};

export const NoFooter: StoryObj<typeof ModalDialog> = {
  args: {
    children: "This dialog has a title but no footer actions.",
    defaultOpen: false,
    disablePointerDismissal: false,
    modal: true,
    title: "About",
    trigger: <Button size="xl">Open</Button>,
  },
};

export const Imperative: StoryObj<typeof ModalDialog> = {
  args: {
    children:
      "This dialog has no trigger prop. It is opened and closed via a handle returned by createHandle().",
    defaultOpen: false,
    disablePointerDismissal: false,
    footer: (
      <ModalDialog.CloseButton variant="solid">Got it</ModalDialog.CloseButton>
    ),
    modal: true,
    title: "Imperatively Controlled",
  },
  render: (args) => {
    const handle = useMemo(() => createHandle(), []);
    return (
      <div className={hstack({ gap: 2 })}>
        <Button
          onClick={() => {
            handle.open(null);
          }}
        >
          Open
        </Button>
        <Button
          onClick={() => {
            handle.close();
          }}
          variant="ghost"
        >
          Close
        </Button>
        <ModalDialog {...args} handle={handle} />
      </div>
    );
  },
};

export const Scrolling: StoryObj<typeof ModalDialog> = {
  args: {
    children: (
      <>
        {Array.from({ length: 25 }, (_, i) => (
          <p key={i}>
            Section {i + 1}. Lorem ipsum dolor sit amet, consectetur adipiscing
            elit. Sed do eiusmod tempor incididunt ut labore et dolore magna
            aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco
            laboris nisi ut aliquip ex ea commodo consequat.
          </p>
        ))}
      </>
    ),
    defaultOpen: false,
    disablePointerDismissal: false,
    footer: (
      <>
        <ModalDialog.CloseButton variant="ghost">
          Decline
        </ModalDialog.CloseButton>
        <Button variant="solid">Accept</Button>
      </>
    ),
    modal: true,
    title: "Terms of Service",
    trigger: <Button size="xl">Open</Button>,
  },
};
