import { Field as BaseField } from "@base-ui/react/field";
import { CodeIcon } from "@phosphor-icons/react/dist/ssr/Code";
import { GlobeIcon } from "@phosphor-icons/react/dist/ssr/Globe";
import { TextAaIcon } from "@phosphor-icons/react/dist/ssr/TextAa";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";

import { iconControl } from "../__test__/iconControl";
import { invalidDecorator } from "../__test__/invalidDecorator";
import { Variants } from "../__test__/Variants";
import type { SelectOption } from "./Select";
import { Select as SelectComponent, SIZES } from "./Select";

const FONT_OPTIONS: readonly SelectOption<string>[] = [
  { label: "Sans-serif", value: "sans" },
  { label: "Serif", value: "serif" },
  { label: "Monospace", value: "mono" },
  { label: "Cursive", value: "cursive" },
];

const LANGUAGE_OPTIONS: readonly SelectOption<string>[] = [
  { label: "TypeScript", value: "ts" },
  { label: "JavaScript", value: "js" },
  { label: "Python", value: "py" },
  { label: "Rust", value: "rs" },
  { label: "Go", value: "go" },
  { label: "Ruby", value: "rb" },
  { label: "Java", value: "java" },
  { label: "C++", value: "cpp" },
  { label: "C", value: "c" },
  { label: "C#", value: "cs" },
  { label: "Kotlin", value: "kt" },
  { label: "Scala", value: "scala" },
  { label: "PHP", value: "php" },
  { label: "Perl", value: "pl" },
  { label: "Lua", value: "lua" },
  { label: "Haskell", value: "hs" },
  { label: "OCaml", value: "ml" },
  { label: "Elixir", value: "ex" },
  { label: "Erlang", value: "erl" },
  { label: "Clojure", value: "clj" },
  { label: "F#", value: "fs" },
  { label: "Dart", value: "dart" },
  { label: "Zig", value: "zig" },
  { label: "Nim", value: "nim" },
  { label: "Crystal", value: "cr" },
  { label: "Julia", value: "jl" },
  { label: "R", value: "r" },
  { label: "MATLAB", value: "m" },
  { label: "Lisp", value: "lisp" },
  { label: "Scheme", value: "scm" },
  { label: "Racket", value: "rkt" },
  { label: "Prolog", value: "prolog" },
  { label: "Smalltalk", value: "st" },
  { label: "Groovy", value: "groovy" },
  { label: "Objective-C", value: "objc" },
  { label: "Assembly", value: "asm" },
  { label: "Fortran", value: "f90" },
  { label: "COBOL", value: "cob" },
  { label: "Ada", value: "ada" },
  { label: "Pascal", value: "pas" },
  { label: "Visual Basic", value: "vb" },
  { label: "PowerShell", value: "ps1" },
  { label: "Bash", value: "sh" },
  { label: "Zsh", value: "zsh" },
  { label: "Fish", value: "fish" },
  { label: "SQL", value: "sql" },
  { label: "HTML", value: "html" },
  { label: "CSS", value: "css" },
  { label: "GraphQL", value: "graphql" },
  { disabled: true, label: "Swift", value: "swift" },
];

const meta = {
  args: {
    disabled: false,
    options: FONT_OPTIONS,
    placeholder: "Choose a font…",
    rounded: false,
    size: "md",
    width: 64,
  },
  argTypes: {
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
    width: {
      control: "number",
      table: { category: "Style" },
    },
  },
  component: SelectComponent,
  parameters: {
    docs: {
      description: {
        component:
          "A styled dropdown that wraps the @base-ui/react Select primitive. Shares the `control` recipe and `wrapperBase` state matrix with Input and Textarea, so size, focus, hover, disabled, and invalid styling are identical. Pass options as `{ value, label }[]`; the trigger renders the matched option's label (or the placeholder if no value is selected).",
      },
    },
  },
  tags: ["autodocs"],
  title: "Forms & Inputs/Select",
} satisfies Meta<typeof SelectComponent>;
export default meta;

export const Select: StoryObj<typeof SelectComponent> = {
  args: {
    disabled: false,
    rounded: false,
    size: "md",
  },
};

export const WithDefaultValue = {
  args: {
    defaultValue: "serif",
    disabled: false,
    rounded: false,
    size: "md",
  },
} satisfies StoryObj<typeof SelectComponent>;

export const WithPrefixIcon = {
  args: {
    defaultValue: "sans",
    disabled: false,
    placeholder: "Choose a font…",
    prefixIcon: <TextAaIcon />,
    rounded: false,
    size: "md",
  },
} satisfies StoryObj<typeof SelectComponent>;

export const Rounded = {
  args: {
    defaultValue: "sans",
    disabled: false,
    prefixIcon: <TextAaIcon />,
    rounded: true,
    size: "md",
  },
} satisfies StoryObj<typeof SelectComponent>;

export const ManyOptions = {
  args: {
    disabled: false,
    options: LANGUAGE_OPTIONS,
    placeholder: "Select a language…",
    prefixIcon: <CodeIcon />,
    rounded: false,
    size: "md",
  },
  parameters: {
    docs: {
      description: {
        story:
          "Demonstrates the popup's max-height + scroll, and the disabled-item appearance (Swift is disabled).",
      },
    },
  },
} satisfies StoryObj<typeof SelectComponent>;

export const Disabled = {
  args: {
    defaultValue: "sans",
    disabled: true,
    prefixIcon: <TextAaIcon />,
    rounded: false,
    size: "md",
  },
} satisfies StoryObj<typeof SelectComponent>;

export const Invalid = {
  args: {
    disabled: false,
    placeholder: "Select a font…",
    prefixIcon: <TextAaIcon />,
    rounded: false,
    size: "md",
  },
  decorators: [invalidDecorator],
  parameters: {
    docs: {
      description: {
        story:
          "Inside an invalid `BaseField.Root`, the wrapper picks up `data-invalid` from context and renders with a danger-colored border and focus ring — same path Input and Textarea use.",
      },
    },
  },
} satisfies StoryObj<typeof SelectComponent>;

export const ToggleValidity: StoryObj<
  ComponentProps<typeof SelectComponent> & { invalid?: boolean | undefined }
> = {
  args: {
    defaultValue: "sans",
    disabled: false,
    invalid: true,
    prefixIcon: <GlobeIcon />,
    rounded: false,
    size: "md",
  },
  argTypes: {
    invalid: {
      control: "boolean",
      table: { category: "State" },
    },
  },
  render: ({ invalid = false, ...args }) => (
    <BaseField.Root invalid={invalid}>
      <SelectComponent {...args} />
    </BaseField.Root>
  ),
};

// Bigger sizes ship more visual weight (taller controls, larger text)
// and need correspondingly more inline space to feel proportionate.
const WIDTH_FOR_SIZE: Record<(typeof SIZES)[number], number> = {
  "2xl": 72,
  "3xl": 96,
  "4xl": 128,
  lg: 48,
  md: 40,
  sm: 36,
  xl: 56,
  xs: 32,
};

export const AllSizes = {
  args: {
    disabled: false,
    options: FONT_OPTIONS,
    placeholder: "Choose…",
    rounded: false,
  },
  parameters: {
    controls: { exclude: ["size"] },
  },
  render: (props) => (
    <Variants
      columnLabel={(column) => column}
      columns={["closed", "with-prefix"] as const}
      rowLabel={(row) => row}
      rows={SIZES}
    >
      {(size, column) => (
        <SelectComponent
          {...props}
          defaultValue="sans"
          prefixIcon={column === "with-prefix" ? <TextAaIcon /> : undefined}
          size={size}
          width={WIDTH_FOR_SIZE[size]}
        />
      )}
    </Variants>
  ),
} satisfies StoryObj<typeof SelectComponent>;
