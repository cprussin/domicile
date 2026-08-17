import type { Meta, StoryObj } from "@storybook/react-vite";

import { iconControl } from "../__test__/iconControl";
import { Variants } from "../__test__/Variants";

import { Button as ButtonComponent, SIZES, VARIANTS } from "./Button";

const meta = {
  argTypes: {
    afterIcon: {
      ...iconControl,
      table: { category: "Contents" },
    },
    beforeIcon: {
      ...iconControl,
      table: { category: "Contents" },
    },
    children: {
      control: "text",
      table: { category: "Contents" },
    },
    disabled: {
      control: "boolean",
      table: { category: "State" },
    },
    href: {
      control: "text",
      table: { category: "Link" },
    },
    label: {
      control: "text",
      table: { category: "Contents" },
    },
    loading: {
      control: "boolean",
      table: { category: "State" },
    },
    onClick: {
      table: {
        category: "Behavior",
      },
    },
    rounded: {
      control: "boolean",
      table: { category: "Style" },
    },
    size: {
      control: "inline-radio",
      options: SIZES,
      table: { category: "Style" },
    },
    target: {
      control: "text",
      table: { category: "Link" },
    },
    variant: {
      control: "inline-radio",
      options: VARIANTS,
      table: { category: "Style" },
    },
  },
  component: ButtonComponent,
  parameters: {
    docs: {
      description: {
        component:
          "A button with two shapes: a labeled string with optional before/after icons, or an icon node with a required sr-only label. Supports multiple variants, sizes, loading, rounded, and link rendering.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Forms & Inputs/Button",
} satisfies Meta<typeof ButtonComponent>;
export default meta;

export const Button: StoryObj<typeof ButtonComponent> = {
  args: {
    children: "Save",
    disabled: false,
    loading: false,
    rounded: false,
    size: "md",
    variant: "primary",
  },
  parameters: {
    controls: { exclude: ["label"] },
  },
};

export const AllVariations = {
  args: {
    children: "Button",
    disabled: false,
    loading: false,
    rounded: false,
  },
  parameters: {
    controls: { exclude: ["size", "variant", "label"] },
  },
  render: (props) => (
    <Variants
      columnLabel={(column) => column}
      columns={VARIANTS}
      rowLabel={(row) => row}
      rows={SIZES}
    >
      {(size, variant) => (
        <ButtonComponent size={size} variant={variant} {...props} />
      )}
    </Variants>
  ),
} satisfies StoryObj<typeof ButtonComponent>;

export const IconOnlyButton = {
  args: {
    children: "FloppyDiskIcon",
    disabled: false,
    label: "Save",
    loading: false,
    rounded: false,
    size: "md",
    variant: "primary",
  },
  argTypes: {
    children: { ...iconControl, table: { category: "Contents" } },
  },
  parameters: {
    controls: { exclude: ["afterIcon", "beforeIcon"] },
  },
} satisfies StoryObj<typeof ButtonComponent>;

export const AllIconOnlyVariations = {
  args: {
    children: "HouseIcon",
    disabled: false,
    label: "Home",
    loading: false,
    rounded: false,
  },
  argTypes: {
    children: { ...iconControl, table: { category: "Contents" } },
  },
  parameters: {
    controls: { exclude: ["size", "variant", "afterIcon", "beforeIcon"] },
  },
  render: ({ beforeIcon, afterIcon, ...props }) => (
    <Variants
      columnLabel={(column) => column}
      columns={VARIANTS}
      rowLabel={(row) => row}
      rows={SIZES}
    >
      {(size, variant) => (
        <ButtonComponent
          label={props.label}
          size={size}
          variant={variant}
          {...props}
        />
      )}
    </Variants>
  ),
} satisfies StoryObj<typeof ButtonComponent>;
