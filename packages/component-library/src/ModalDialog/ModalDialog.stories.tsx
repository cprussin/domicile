import type { Meta, StoryObj } from "@storybook/react-vite";
import { useMemo } from "react";
import { hstack } from "../../styled-system/patterns";
import { Button } from "../Button/Button";

import { createHandle, ModalDialog, PLACEMENTS } from "./ModalDialog";

const meta = {
  args: {
    closeButton: true,
    defaultOpen: false,
    disablePointerDismissal: false,
    modal: true,
    placement: "center",
  },
  argTypes: {
    children: {
      control: "text",
      table: { category: "Contents" },
    },
    closeButton: {
      control: "boolean",
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
    placement: {
      control: "inline-radio",
      options: PLACEMENTS,
      table: { category: "Appearance" },
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
          "A modal dialog with an optional title, footer, and trigger. Wraps the @base-ui/react Dialog primitive and always renders a portal, backdrop, popup and body; the corner close button and the placement in the viewport are the caller's to choose.",
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
    closeButton: true,
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
    placement: "center",
    title: "Settings",
    trigger: <Button size="xl">Click Me</Button>,
  },
};

export const NoTitle: StoryObj<typeof ModalDialog> = {
  args: {
    children: "This dialog has no title, but still shows a close button.",
    closeButton: true,
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
    placement: "center",
    trigger: <Button size="xl">Open</Button>,
  },
};

export const NoTitleOrFooter: StoryObj<typeof ModalDialog> = {
  args: {
    children:
      "This dialog has no title and no footer — just body content and a close button.",
    closeButton: true,
    defaultOpen: false,
    disablePointerDismissal: false,
    modal: true,
    placement: "center",
    trigger: <Button size="xl">Open</Button>,
  },
};

export const NoFooter: StoryObj<typeof ModalDialog> = {
  args: {
    children: "This dialog has a title but no footer actions.",
    closeButton: true,
    defaultOpen: false,
    disablePointerDismissal: false,
    modal: true,
    placement: "center",
    title: "About",
    trigger: <Button size="xl">Open</Button>,
  },
};

export const Imperative: StoryObj<typeof ModalDialog> = {
  args: {
    children:
      "This dialog has no trigger prop. It is opened and closed via a handle returned by createHandle().",
    closeButton: true,
    defaultOpen: false,
    disablePointerDismissal: false,
    footer: (
      <ModalDialog.CloseButton variant="solid">Got it</ModalDialog.CloseButton>
    ),
    modal: true,
    placement: "center",
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

export const Palette: StoryObj<typeof ModalDialog> = {
  args: {
    children:
      "A panel that is typed into rather than read: at the top of the screen, and with no corner button because what closes it is Escape.",
    closeButton: false,
    defaultOpen: false,
    disablePointerDismissal: false,
    modal: true,
    placement: "top",
    title: "Open",
    trigger: <Button size="xl">Open</Button>,
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
    closeButton: true,
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
    placement: "center",
    title: "Terms of Service",
    trigger: <Button size="xl">Open</Button>,
  },
};
