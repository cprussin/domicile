import type { Meta, StoryObj } from "@storybook/react-vite";

import { Switch as SwitchComponent } from "./Switch";

const meta = {
  args: {
    defaultChecked: true,
    disabled: false,
    label: "Share clipboard",
  },
  argTypes: {
    defaultChecked: {
      control: "boolean",
      table: { category: "State" },
    },
    disabled: {
      control: "boolean",
      table: { category: "State" },
    },
    label: {
      control: "text",
      table: { category: "Contents" },
    },
    onCheckedChange: {
      control: false,
      table: { category: "Events" },
    },
  },
  component: SwitchComponent,
  parameters: {
    docs: {
      description: {
        component:
          "An on/off switch named by the label beside it. Wraps the @base-ui/react Switch primitive.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Forms & Inputs/Switch",
} satisfies Meta<typeof SwitchComponent>;
export default meta;

export const Switch: StoryObj<typeof SwitchComponent> = {
  args: { defaultChecked: true, disabled: false },
};

export const Off: StoryObj<typeof SwitchComponent> = {
  args: { defaultChecked: false, disabled: false },
};

export const Disabled: StoryObj<typeof SwitchComponent> = {
  args: { defaultChecked: true, disabled: true },
};
