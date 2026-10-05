import type { Meta, StoryObj } from "@storybook/react-vite";

import { ContextMenu as ContextMenuComponent } from "./ContextMenu";

const meta = {
  args: {
    at: { x: 120, y: 80 },
    children: (
      <>
        <ContextMenuComponent.Item>Back</ContextMenuComponent.Item>
        <ContextMenuComponent.Item disabled>Forward</ContextMenuComponent.Item>
        <ContextMenuComponent.Item>Reload</ContextMenuComponent.Item>
        <ContextMenuComponent.Separator />
        <ContextMenuComponent.Item>
          Open link in new window
        </ContextMenuComponent.Item>
        <ContextMenuComponent.Item>Copy link address</ContextMenuComponent.Item>
        <ContextMenuComponent.Separator />
        <ContextMenuComponent.Item shortcut="Ctrl+Shift+I">
          Inspect
        </ContextMenuComponent.Item>
      </>
    ),
    label: "Page",
    open: true,
  },
  argTypes: {
    at: {
      control: "object",
      table: { category: "Position" },
    },
    children: {
      control: false,
      table: { category: "Contents" },
    },
    defaultOpen: {
      control: "boolean",
      table: { category: "State" },
    },
    label: {
      control: "text",
      table: { category: "Contents" },
    },
    open: {
      control: "boolean",
      table: { category: "State" },
    },
  },
  component: ContextMenuComponent,
  parameters: {
    docs: {
      description: {
        component:
          "A menu opened at a point rather than from a control — a right click's — wrapping the @base-ui/react Menu primitive. The caller opens it and hears it close; it takes the keyboard while open.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Overlays/ContextMenu",
} satisfies Meta<typeof ContextMenuComponent>;
export default meta;

export const ContextMenu: StoryObj<typeof ContextMenuComponent> = {
  args: {
    at: { x: 120, y: 80 },
    label: "Page",
    open: true,
  },
};
