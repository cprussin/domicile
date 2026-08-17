import { Field as BaseField } from "@base-ui/react/field";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/ssr/ArrowRight";
import { CaretDownIcon } from "@phosphor-icons/react/dist/ssr/CaretDown";
import { FunnelIcon } from "@phosphor-icons/react/dist/ssr/Funnel";
import { LockIcon } from "@phosphor-icons/react/dist/ssr/Lock";
import { MarkdownLogoIcon } from "@phosphor-icons/react/dist/ssr/MarkdownLogo";
import { NotePencilIcon } from "@phosphor-icons/react/dist/ssr/NotePencil";
import { PaperclipIcon } from "@phosphor-icons/react/dist/ssr/Paperclip";
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

import { SIZES, Textarea as TextareaComponent } from "./Textarea";

type BaseProps = Omit<
  ComponentProps<typeof TextareaComponent>,
  "clearable" | "prefixIcon" | "size" | "suffixButtons" | "suffixIcon"
>;

const renderVariation = createRenderVariation<BaseProps>({
  Component: TextareaComponent,
  prefixIcon: <NotePencilIcon />,
  primaryButtonLabel: "Attach",
  suffixButtonIcons: {
    primary: <PaperclipIcon />,
    secondary: <ArrowRightIcon />,
  },
  suffixIcon: <MarkdownLogoIcon />,
});

const meta = {
  args: {
    autoSize: false,
    clearable: false,
    disabled: false,
    disableResize: false,
    placeholder: "Type something...",
    rounded: false,
    size: "md",
    width: 80,
  },
  argTypes: {
    autoSize: {
      control: "boolean",
      table: { category: "Style" },
    },
    clearable: {
      control: "boolean",
      table: { category: "Contents" },
    },
    defaultValue: {
      control: "text",
      table: { category: "Contents" },
    },
    disabled: {
      control: "boolean",
      table: { category: "State" },
    },
    disableResize: {
      control: "boolean",
      table: { category: "Style" },
    },
    height: {
      control: "number",
      table: { category: "Style" },
    },
    maxHeight: {
      control: "number",
      table: { category: "Style" },
    },
    minHeight: {
      control: "number",
      table: { category: "Style" },
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
    width: {
      control: "number",
      table: { category: "Style" },
    },
  },
  component: TextareaComponent,
  parameters: {
    docs: {
      description: {
        component:
          "A multi-line text input mirroring Input's API: supports prefix icon, mutually-exclusive suffix icon or suffix buttons, clearable, rounded, disabled, and invalid states. Use `height`, `minHeight`, and `maxHeight` (numeric spacing-token values) to control vertical sizing, or `autoSize` to grow the textarea to fit content (capped at `maxHeight` if set, which switches the overflow to scroll).",
      },
    },
  },
  tags: ["autodocs"],
  title: "Forms & Inputs/Textarea",
} satisfies Meta<typeof TextareaComponent>;
export default meta;

export const Textarea: StoryObj<typeof TextareaComponent> = {
  args: {
    clearable: false,
    disabled: false,
    disableResize: false,
    rounded: false,
    size: "md",
  },
};

export const WithPrefixIcon = {
  args: {
    clearable: false,
    disabled: false,
    disableResize: false,
    minHeight: 24,
    placeholder: "Describe the issue…",
    prefixIcon: <NotePencilIcon />,
    rounded: false,
    size: "md",
  },
  parameters: {
    controls: { exclude: ["suffixIcon"] },
  },
} satisfies StoryObj<typeof TextareaComponent>;

export const WithSuffixIcon = {
  args: {
    clearable: false,
    disabled: false,
    disableResize: false,
    minHeight: 24,
    placeholder: "Markdown supported…",
    rounded: false,
    size: "md",
    suffixIcon: <MarkdownLogoIcon />,
  },
  parameters: {
    controls: { exclude: ["prefixIcon"] },
  },
} satisfies StoryObj<typeof TextareaComponent>;

export const WithSuffixButtons = {
  args: {
    clearable: false,
    disabled: false,
    disableResize: false,
    minHeight: 24,
    placeholder: "Write a comment…",
    rounded: false,
    size: "md",
    suffixButtons: (
      <>
        <Button label="Attach" size="sm" variant="ghost">
          <PaperclipIcon />
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
} satisfies StoryObj<typeof TextareaComponent>;

export const WithPrefixIconAndSuffixIcon = {
  args: {
    clearable: false,
    disabled: false,
    disableResize: false,
    minHeight: 24,
    placeholder: "Filter by tag…",
    prefixIcon: <FunnelIcon />,
    rounded: false,
    size: "md",
    suffixIcon: <CaretDownIcon />,
  },
} satisfies StoryObj<typeof TextareaComponent>;

export const Clearable = {
  args: {
    clearable: true,
    defaultValue: "Clear me\nI span multiple lines",
    disabled: false,
    disableResize: false,
    minHeight: 24,
    placeholder: "Type something…",
    prefixIcon: <NotePencilIcon />,
    rounded: false,
    size: "md",
  },
  parameters: {
    controls: { exclude: ["suffixButtons", "suffixIcon"] },
  },
} satisfies StoryObj<typeof TextareaComponent>;

export const Rounded = {
  args: {
    clearable: false,
    disabled: false,
    disableResize: false,
    placeholder: "Tell us more…",
    prefixIcon: <NotePencilIcon />,
    rounded: true,
    size: "md",
  },
} satisfies StoryObj<typeof TextareaComponent>;

export const AutoSize = {
  args: {
    autoSize: true,
    clearable: false,
    disabled: false,
    maxHeight: 40,
    placeholder: "Start typing — the textarea will grow with the content…",
    rounded: false,
    size: "md",
  },
  parameters: {
    controls: {
      exclude: ["disableResize", "height", "minHeight"],
    },
    docs: {
      description: {
        story:
          "With `autoSize`, the textarea matches its content height on every change. The manual resize handle and any fixed `height` are suppressed; `maxHeight` still applies as a ceiling beyond which content overflows into the textarea's own scrollbar.",
      },
    },
  },
} satisfies StoryObj<typeof TextareaComponent>;

export const Disabled = {
  args: {
    clearable: false,
    defaultValue:
      "This account's bio is locked.\nContact support to make changes.",
    disabled: true,
    disableResize: false,
    minHeight: 24,
    placeholder: "Bio",
    prefixIcon: <LockIcon />,
    rounded: false,
    size: "md",
  },
} satisfies StoryObj<typeof TextareaComponent>;

export const Invalid = {
  args: {
    clearable: false,
    defaultValue: "too short",
    disabled: false,
    disableResize: false,
    minHeight: 24,
    placeholder: "Describe in at least 20 characters…",
    prefixIcon: <NotePencilIcon />,
    rounded: false,
    size: "md",
  },
  decorators: [invalidDecorator],
  parameters: {
    docs: {
      description: {
        story:
          "When the Textarea is inside an invalid `Field` (or any base-ui Field with `invalid={true}`), it picks up `data-invalid` from context and renders with a danger-colored border and focus ring.",
      },
    },
  },
} satisfies StoryObj<typeof TextareaComponent>;

export const ToggleValidity: StoryObj<
  ComponentProps<typeof TextareaComponent> & { invalid?: boolean | undefined }
> = {
  args: {
    clearable: false,
    defaultValue: "too short",
    disabled: false,
    disableResize: false,
    invalid: true,
    minHeight: 24,
    placeholder: "Describe in at least 20 characters…",
    prefixIcon: <NotePencilIcon />,
    rounded: false,
    size: "md",
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
          "Toggle the `invalid` control to see how the Textarea transitions between valid and invalid states. The Textarea itself reads `data-invalid` from a surrounding base-ui `Field`, so the story wraps it in `<BaseField.Root invalid={invalid}>`.",
      },
    },
  },
  render: ({ invalid = false, ...args }) => (
    <BaseField.Root invalid={invalid}>
      <TextareaComponent {...args} />
    </BaseField.Root>
  ),
};

export const InvalidClearable = {
  args: {
    clearable: true,
    defaultValue: "x",
    disabled: false,
    disableResize: false,
    minHeight: 24,
    placeholder: "Describe the issue…",
    prefixIcon: <NotePencilIcon />,
    rounded: false,
    size: "md",
  },
  decorators: [invalidDecorator],
} satisfies StoryObj<typeof TextareaComponent>;

export const InvalidWithSuffixIcon = {
  args: {
    clearable: false,
    defaultValue: "missing closing tag",
    disabled: false,
    disableResize: false,
    minHeight: 24,
    placeholder: "Paste your markdown…",
    rounded: false,
    size: "md",
    suffixIcon: <MarkdownLogoIcon />,
  },
  decorators: [invalidDecorator],
} satisfies StoryObj<typeof TextareaComponent>;

export const AllVariations = {
  args: {
    clearable: false,
    disabled: false,
    disableResize: false,
    minHeight: 20,
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
} satisfies StoryObj<typeof TextareaComponent>;

export const AllInvalidVariations = {
  args: {
    clearable: false,
    disabled: false,
    disableResize: false,
    minHeight: 20,
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
} satisfies StoryObj<typeof TextareaComponent>;
