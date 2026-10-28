import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr/CaretRight";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { IconButton as IconButtonComponent, SIZES } from "./IconButton";

const meta = {
  args: {
    children: <CaretRightIcon aria-hidden size={14} weight="bold" />,
    disabled: false,
    label: "Sound details",
    size: "md",
  },
  argTypes: {
    children: { control: false, table: { category: "Contents" } },
    disabled: { control: "boolean", table: { category: "State" } },
    label: { control: "text", table: { category: "Contents" } },
    size: {
      control: "inline-radio",
      options: SIZES,
      table: { category: "Appearance" },
    },
  },
  component: IconButtonComponent,
  parameters: {
    docs: {
      description: {
        component:
          "A round, quiet button that shows only an icon, such as a panel's back arrow or a row's details arrow. Drawn in `currentcolor`.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Inputs/IconButton",
} satisfies Meta<typeof IconButtonComponent>;
export default meta;

export const IconButton: StoryObj<typeof IconButtonComponent> = {};

export const Small: StoryObj<typeof IconButtonComponent> = {
  args: { size: "sm" },
};
