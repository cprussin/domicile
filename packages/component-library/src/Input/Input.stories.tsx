import { Field as BaseField } from "@base-ui/react/field";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/ssr/ArrowRight";
import { CaretDownIcon } from "@phosphor-icons/react/dist/ssr/CaretDown";
import { CurrencyDollarIcon } from "@phosphor-icons/react/dist/ssr/CurrencyDollar";
import { EnvelopeIcon } from "@phosphor-icons/react/dist/ssr/Envelope";
import { FunnelIcon } from "@phosphor-icons/react/dist/ssr/Funnel";
import { LockIcon } from "@phosphor-icons/react/dist/ssr/Lock";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/ssr/MagnifyingGlass";
import { XIcon } from "@phosphor-icons/react/dist/ssr/X";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";

import {
  ADORNMENT_CONFIGS,
  adornmentLabel,
  createRenderVariation,
} from "../__test__/adornmentVariations";
import { iconControl } from "../__test__/iconControl";
import { invalidDecorator } from "../__test__/invalidDecorator";
import { Variants } from "../__test__/Variants";
import { Button } from "../Button/Button";

import { Input as InputComponent, SIZES } from "./Input";

type BaseProps = Omit<
  ComponentProps<typeof InputComponent>,
  "clearable" | "prefixIcon" | "size" | "suffixButtons" | "suffixIcon"
>;

const renderVariation = createRenderVariation<BaseProps>({
  Component: InputComponent,
  prefixIcon: <MagnifyingGlassIcon />,
  primaryButtonLabel: "Clear",
  suffixButtonIcons: { primary: <XIcon />, secondary: <ArrowRightIcon /> },
  suffixIcon: <CurrencyDollarIcon />,
});

const meta = {
  args: {
    clearable: false,
    disabled: false,
    placeholder: "Type something...",
    rounded: false,
    type: "text",
    width: 80,
  },
  argTypes: {
    clearable: {
      control: "boolean",
      table: { category: "Contents" },
    },
    disabled: {
      control: "boolean",
      table: { category: "State" },
    },
    placeholder: {
      control: "text",
      table: { category: "Contents" },
    },
    prefixIcon: {
      ...iconControl,
      table: { category: "Contents" },
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
    suffixIcon: {
      ...iconControl,
      table: { category: "Contents" },
    },
    type: {
      control: "select",
      options: ["text", "password", "email", "url"],
      table: { category: "Behavior" },
    },
    width: {
      control: "number",
      table: { category: "Style" },
    },
  },
  component: InputComponent,
  parameters: {
    docs: {
      description: {
        component:
          "A styled single-line input that wraps the @base-ui/react Input primitive with size variants, optional prefix icon, mutually-exclusive trailing content (decorative suffix icon or a group of suffix buttons), and an optional rounded shape.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Forms & Inputs/Input",
} satisfies Meta<typeof InputComponent>;
export default meta;

export const Input: StoryObj<typeof InputComponent> = {
  args: {
    clearable: false,
    disabled: false,
    rounded: false,
    size: "md",
  },
};

export const WithPrefixIcon = {
  args: {
    clearable: false,
    disabled: false,
    placeholder: "Search…",
    prefixIcon: <MagnifyingGlassIcon />,
    rounded: false,
    size: "md",
  },
  parameters: {
    controls: { exclude: ["suffixIcon"] },
  },
} satisfies StoryObj<typeof InputComponent>;

export const WithSuffixIcon = {
  args: {
    clearable: false,
    disabled: false,
    placeholder: "0.00",
    rounded: false,
    size: "md",
    suffixIcon: <CurrencyDollarIcon />,
  },
  parameters: {
    controls: { exclude: ["prefixIcon"] },
  },
} satisfies StoryObj<typeof InputComponent>;

export const WithSuffixButtons = {
  args: {
    clearable: false,
    disabled: false,
    placeholder: "Search the web…",
    prefixIcon: <MagnifyingGlassIcon />,
    rounded: false,
    size: "md",
    suffixButtons: (
      <>
        <Button label="Clear" size="sm" variant="ghost">
          <XIcon />
        </Button>
        <Button label="Submit" size="sm" variant="ghost">
          <ArrowRightIcon />
        </Button>
      </>
    ),
  },
  parameters: {
    controls: { exclude: ["suffixIcon"] },
  },
} satisfies StoryObj<typeof InputComponent>;

export const WithPrefixIconAndSuffixIcon = {
  args: {
    clearable: false,
    disabled: false,
    placeholder: "Type to filter",
    prefixIcon: <FunnelIcon />,
    rounded: false,
    size: "md",
    suffixIcon: <CaretDownIcon />,
  },
} satisfies StoryObj<typeof InputComponent>;

export const Clearable = {
  args: {
    clearable: true,
    defaultValue: "Clear me",
    disabled: false,
    placeholder: "Type to search…",
    prefixIcon: <MagnifyingGlassIcon />,
    rounded: false,
    size: "md",
  },
  parameters: {
    controls: { exclude: ["suffixButtons", "suffixIcon"] },
  },
} satisfies StoryObj<typeof InputComponent>;

export const Rounded = {
  args: {
    clearable: false,
    disabled: false,
    placeholder: "Search…",
    prefixIcon: <MagnifyingGlassIcon />,
    rounded: true,
    size: "md",
  },
} satisfies StoryObj<typeof InputComponent>;

export const Disabled = {
  args: {
    clearable: false,
    disabled: true,
    placeholder: "Cannot edit",
    prefixIcon: <LockIcon />,
    rounded: false,
    size: "md",
    value: "read-only value",
  },
} satisfies StoryObj<typeof InputComponent>;

export const Invalid = {
  args: {
    clearable: false,
    defaultValue: "not-an-email",
    disabled: false,
    placeholder: "you@example.com",
    prefixIcon: <EnvelopeIcon />,
    rounded: false,
    size: "md",
    type: "email",
  },
  decorators: [invalidDecorator],
  parameters: {
    docs: {
      description: {
        story:
          "When the Input is inside an invalid `Field` (or any base-ui Field with `invalid={true}`), it picks up `data-invalid` from context and renders with a danger-colored border and focus ring.",
      },
    },
  },
} satisfies StoryObj<typeof InputComponent>;

export const ToggleValidity: StoryObj<
  ComponentProps<typeof InputComponent> & { invalid?: boolean | undefined }
> = {
  args: {
    clearable: false,
    defaultValue: "not-an-email",
    disabled: false,
    invalid: true,
    placeholder: "you@example.com",
    prefixIcon: <EnvelopeIcon />,
    rounded: false,
    size: "md",
    type: "email",
  },
  argTypes: {
    invalid: {
      control: "boolean",
      table: { category: "State" },
    },
  },
  parameters: {
    docs: {
      description: {
        story:
          "Toggle the `invalid` control to see how the Input transitions between valid and invalid states. The Input itself reads `data-invalid` from a surrounding base-ui `Field`, so the story wraps it in `<BaseField.Root invalid={invalid}>`.",
      },
    },
  },
  render: ({ invalid = false, ...args }) => (
    <BaseField.Root invalid={invalid}>
      <InputComponent {...args} />
    </BaseField.Root>
  ),
};

export const InvalidClearable = {
  args: {
    clearable: true,
    defaultValue: "x",
    disabled: false,
    placeholder: "Search…",
    prefixIcon: <MagnifyingGlassIcon />,
    rounded: false,
    size: "md",
  },
  decorators: [invalidDecorator],
} satisfies StoryObj<typeof InputComponent>;

export const InvalidWithSuffixIcon = {
  args: {
    clearable: false,
    defaultValue: "-3.5",
    disabled: false,
    placeholder: "0.00",
    rounded: false,
    size: "md",
    suffixIcon: <CurrencyDollarIcon />,
  },
  decorators: [invalidDecorator],
} satisfies StoryObj<typeof InputComponent>;

export const AllVariations = {
  args: {
    clearable: false,
    disabled: false,
    placeholder: "Type something…",
    rounded: false,
  },
  parameters: {
    controls: {
      exclude: ["clearable", "prefixIcon", "size", "suffixIcon"],
    },
  },
  render: (props) => (
    <Variants
      columnLabel={(column) => column}
      columns={SIZES}
      rowLabel={adornmentLabel}
      rows={ADORNMENT_CONFIGS}
    >
      {(config, size) => renderVariation(size, config, props)}
    </Variants>
  ),
} satisfies StoryObj<typeof InputComponent>;

export const AllInvalidVariations = {
  args: {
    clearable: false,
    disabled: false,
    placeholder: "Type something…",
    rounded: false,
  },
  parameters: {
    controls: {
      exclude: ["clearable", "prefixIcon", "size", "suffixIcon"],
    },
    docs: {
      description: {
        story:
          "Every variation rendered inside an invalid `BaseField.Root`, so each cell picks up `data-invalid` and shows the danger-colored border and focus ring.",
      },
    },
  },
  render: (props) => (
    <Variants
      columnLabel={(column) => column}
      columns={SIZES}
      rowLabel={adornmentLabel}
      rows={ADORNMENT_CONFIGS}
    >
      {(config, size) => (
        <BaseField.Root invalid>
          {renderVariation(size, config, props)}
        </BaseField.Root>
      )}
    </Variants>
  ),
} satisfies StoryObj<typeof InputComponent>;
