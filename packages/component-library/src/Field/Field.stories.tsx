import { EnvelopeIcon } from "@phosphor-icons/react/dist/ssr/Envelope";
import { GlobeIcon } from "@phosphor-icons/react/dist/ssr/Globe";
import { NotePencilIcon } from "@phosphor-icons/react/dist/ssr/NotePencil";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { flex } from "../../styled-system/patterns";
import { Button } from "../Button/Button";
import { Input } from "../Input/Input";
import type { SelectOption } from "../Select/Select";
import { Select } from "../Select/Select";
import { Textarea } from "../Textarea/Textarea";

import { Field as FieldComponent } from "./Field";

const TIMEZONE_OPTIONS: readonly SelectOption<string>[] = [
  { label: "Pacific Time (PT)", value: "pt" },
  { label: "Mountain Time (MT)", value: "mt" },
  { label: "Central Time (CT)", value: "ct" },
  { label: "Eastern Time (ET)", value: "et" },
  { label: "Coordinated Universal Time (UTC)", value: "utc" },
];

const meta = {
  args: {
    disabled: false,
    hint: "We will not share this with anyone.",
    invalid: false,
    label: "Email address",
  },
  argTypes: {
    disabled: {
      control: "boolean",
      table: { category: "State" },
    },
    error: {
      control: "text",
      table: { category: "State" },
    },
    hint: {
      control: "text",
      table: { category: "Contents" },
    },
    invalid: {
      control: "boolean",
      table: { category: "State" },
    },
    label: {
      control: "text",
      table: { category: "Contents" },
    },
  },
  component: FieldComponent,
  parameters: {
    docs: {
      description: {
        component:
          "Wraps a form control with a label, an optional descriptive hint, and an error message that appears when the field is invalid.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Forms & Inputs/Field",
} satisfies Meta<typeof FieldComponent>;
export default meta;

export const Field: StoryObj<typeof FieldComponent> = {
  args: {
    disabled: false,
    invalid: false,
  },
  render: (args) => (
    <FieldComponent {...args}>
      <Input
        placeholder="you@example.com"
        prefixIcon={<EnvelopeIcon />}
        type="email"
      />
    </FieldComponent>
  ),
};

export const WithError = {
  args: {
    disabled: false,
    error: "Please enter a valid email address.",
    hint: "We will not share this with anyone.",
    invalid: false,
    label: "Email address",
  },
  render: (args) => (
    <FieldComponent {...args}>
      <Input
        defaultValue="not-an-email"
        placeholder="you@example.com"
        prefixIcon={<EnvelopeIcon />}
        type="email"
      />
    </FieldComponent>
  ),
} satisfies StoryObj<typeof FieldComponent>;

export const Disabled = {
  args: {
    disabled: true,
    hint: "Email cannot be edited for this account.",
    invalid: false,
    label: "Email address",
  },
  render: (args) => (
    <FieldComponent {...args}>
      <Input
        defaultValue="connor@dourolabs.xyz"
        placeholder="you@example.com"
        prefixIcon={<EnvelopeIcon />}
        type="email"
      />
    </FieldComponent>
  ),
} satisfies StoryObj<typeof FieldComponent>;

export const InteractiveError = {
  args: {
    disabled: false,
    invalid: false,
  },
  parameters: {
    controls: { exclude: ["error"] },
    docs: {
      description: {
        story:
          "Click 'Trigger error' to set an error message and open the popover; click 'Clear error' to remove it. Useful for verifying that the popover opens and closes as the `error` prop changes.",
      },
    },
  },
  render: (args) => {
    const [error, setError] = useState<string | undefined>(undefined);
    return (
      <div>
        <FieldComponent {...args} error={error}>
          <Input
            defaultValue="user@example.com"
            placeholder="you@example.com"
            prefixIcon={<EnvelopeIcon />}
            type="email"
          />
        </FieldComponent>
        <div className={flex({ gap: 2, marginBlockStart: 6 })}>
          <Button
            onClick={() => {
              setError("Please enter a valid email address.");
            }}
            size="sm"
            variant="danger"
          >
            Trigger error
          </Button>
          <Button
            onClick={() => {
              setError(undefined);
            }}
            size="sm"
            variant="outline"
          >
            Clear error
          </Button>
        </div>
      </div>
    );
  },
} satisfies StoryObj<typeof FieldComponent>;

export const RequiredValidation = {
  args: {
    disabled: false,
    hint: "Type at least 3 characters, then tab out to validate.",
    invalid: false,
    label: "Username",
    validationMode: "onBlur",
  },
  parameters: {
    docs: {
      description: {
        story:
          "Demonstrates HTML5 validation: tab away from the empty input and the Field automatically surfaces the browser's validation message via its error popover — no manual error tracking required.",
      },
    },
  },
  render: (args) => (
    <FieldComponent {...args}>
      <Input minLength={3} placeholder="Pick a username" required type="text" />
    </FieldComponent>
  ),
} satisfies StoryObj<typeof FieldComponent>;

export const WithTextarea = {
  args: {
    disabled: false,
    hint: "Markdown is supported.",
    invalid: false,
    label: "Bio",
  },
  parameters: {
    docs: {
      description: {
        story:
          "A `Field` wrapping a `Textarea` instead of an `Input`. `BaseField.Control` inside `Textarea` automatically picks up the field's label, hint, and validation state.",
      },
    },
  },
  render: (args) => (
    <FieldComponent {...args}>
      <Textarea
        placeholder="Tell us about yourself…"
        prefixIcon={<NotePencilIcon />}
        rows={4}
      />
    </FieldComponent>
  ),
} satisfies StoryObj<typeof FieldComponent>;

export const WithTextareaError = {
  args: {
    disabled: false,
    error: "Please write at least 20 characters.",
    hint: "Markdown is supported.",
    invalid: false,
    label: "Bio",
  },
  render: (args) => (
    <FieldComponent {...args}>
      <Textarea
        defaultValue="too short"
        placeholder="Tell us about yourself…"
        prefixIcon={<NotePencilIcon />}
        rows={4}
      />
    </FieldComponent>
  ),
} satisfies StoryObj<typeof FieldComponent>;

export const WithTextareaDisabled = {
  args: {
    disabled: true,
    hint: "Bio is locked for this account.",
    invalid: false,
    label: "Bio",
  },
  render: (args) => (
    <FieldComponent {...args}>
      <Textarea
        defaultValue={
          "This account's bio is locked.\nContact support to make changes."
        }
        placeholder="Tell us about yourself…"
        prefixIcon={<NotePencilIcon />}
        rows={4}
      />
    </FieldComponent>
  ),
} satisfies StoryObj<typeof FieldComponent>;

export const NoLabel = {
  args: {
    disabled: false,
    hint: "We will not share this with anyone.",
    invalid: false,
    label: undefined,
  },
  parameters: {
    docs: {
      description: {
        story:
          "Field with only a hint and no label. The label slot is omitted entirely, so the field starts at the hint or control.",
      },
    },
  },
  render: (args) => (
    <FieldComponent {...args}>
      <Input
        placeholder="you@example.com"
        prefixIcon={<EnvelopeIcon />}
        type="email"
      />
    </FieldComponent>
  ),
} satisfies StoryObj<typeof FieldComponent>;

export const NoHint = {
  args: {
    disabled: false,
    hint: undefined,
    invalid: false,
    label: "Email address",
  },
  parameters: {
    docs: {
      description: {
        story:
          "Field with only a label and no hint. The hint slot is omitted entirely so the control sits flush below the label.",
      },
    },
  },
  render: (args) => (
    <FieldComponent {...args}>
      <Input
        placeholder="you@example.com"
        prefixIcon={<EnvelopeIcon />}
        type="email"
      />
    </FieldComponent>
  ),
} satisfies StoryObj<typeof FieldComponent>;

export const NoLabelOrHint = {
  args: {
    disabled: false,
    hint: undefined,
    invalid: false,
    label: undefined,
  },
  parameters: {
    docs: {
      description: {
        story:
          "Field with no label and no hint — just the control. Useful for compact forms where the labelling is implicit (e.g. a search box with a prefix icon and placeholder).",
      },
    },
  },
  render: (args) => (
    <FieldComponent {...args}>
      <Input
        placeholder="Search…"
        prefixIcon={<EnvelopeIcon />}
        type="search"
      />
    </FieldComponent>
  ),
} satisfies StoryObj<typeof FieldComponent>;

export const WithTextareaRequiredValidation = {
  args: {
    disabled: false,
    hint: "Write at least 20 characters, then tab out to validate.",
    invalid: false,
    label: "Bio",
    validationMode: "onBlur",
  },
  parameters: {
    docs: {
      description: {
        story:
          "Demonstrates HTML5 validation on a `Textarea`: tab away from the empty textarea and the Field automatically surfaces the browser's validation message via its error popover — no manual error tracking required.",
      },
    },
  },
  render: (args) => (
    <FieldComponent {...args}>
      <Textarea
        minLength={20}
        placeholder="Tell us about yourself…"
        prefixIcon={<NotePencilIcon />}
        required
        rows={4}
      />
    </FieldComponent>
  ),
} satisfies StoryObj<typeof FieldComponent>;

export const WithSelect = {
  args: {
    disabled: false,
    hint: "Used for scheduled report delivery.",
    invalid: false,
    label: "Timezone",
  },
  parameters: {
    docs: {
      description: {
        story:
          "A `Field` wrapping a `Select`. The Select trigger picks up the field's label via base-ui's Field context, so clicking the label opens the dropdown.",
      },
    },
  },
  render: (args) => (
    <FieldComponent {...args}>
      <Select
        defaultValue="pt"
        options={TIMEZONE_OPTIONS}
        prefixIcon={<GlobeIcon />}
      />
    </FieldComponent>
  ),
} satisfies StoryObj<typeof FieldComponent>;

export const WithSelectError = {
  args: {
    disabled: false,
    error: "Please choose a timezone before continuing.",
    hint: "Used for scheduled report delivery.",
    invalid: false,
    label: "Timezone",
  },
  parameters: {
    docs: {
      description: {
        story:
          "A `Field` + `Select` rendering an explicit error. The trigger picks up `data-invalid` from the surrounding field, so the wrapper border turns danger-colored and the error popover anchors to the trigger.",
      },
    },
  },
  render: (args) => (
    <FieldComponent {...args}>
      <Select
        options={TIMEZONE_OPTIONS}
        placeholder="Select a timezone…"
        prefixIcon={<GlobeIcon />}
      />
    </FieldComponent>
  ),
} satisfies StoryObj<typeof FieldComponent>;

export const WithSelectDisabled = {
  args: {
    disabled: true,
    hint: "Timezone is locked for this account.",
    invalid: false,
    label: "Timezone",
  },
  render: (args) => (
    <FieldComponent {...args}>
      <Select
        defaultValue="pt"
        options={TIMEZONE_OPTIONS}
        prefixIcon={<GlobeIcon />}
      />
    </FieldComponent>
  ),
} satisfies StoryObj<typeof FieldComponent>;
