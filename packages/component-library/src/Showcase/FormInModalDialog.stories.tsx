import { EnvelopeIcon } from "@phosphor-icons/react/dist/ssr/Envelope";
import { GlobeIcon } from "@phosphor-icons/react/dist/ssr/Globe";
import { NotePencilIcon } from "@phosphor-icons/react/dist/ssr/NotePencil";
import { UserIcon } from "@phosphor-icons/react/dist/ssr/User";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { flex } from "../../styled-system/patterns";
import { Button } from "../Button/Button";
import { Field } from "../Field/Field";
import { Input } from "../Input/Input";
import { ModalDialog } from "../ModalDialog/ModalDialog";
import type { SelectOption } from "../Select/Select";
import { Select } from "../Select/Select";
import { Textarea } from "../Textarea/Textarea";

const TIMEZONE_OPTIONS: readonly SelectOption<string>[] = [
  { label: "Pacific Time (PT)", value: "pt" },
  { label: "Mountain Time (MT)", value: "mt" },
  { label: "Central Time (CT)", value: "ct" },
  { label: "Eastern Time (ET)", value: "et" },
  { label: "Coordinated Universal Time (UTC)", value: "utc" },
];

const VISIBILITY_OPTIONS: readonly SelectOption<string>[] = [
  { label: "Public — anyone can see your profile", value: "public" },
  { label: "Unlisted — only people with the link", value: "unlisted" },
  { label: "Private — only you", value: "private" },
];

const meta = {
  parameters: {
    docs: {
      description: {
        component:
          "A form composed of Field-wrapped controls — one of every form component the library exposes (Input, Select, Textarea) — inside a ModalDialog, with action Buttons in the footer.",
      },
    },
    options: { showPanel: false },
  },
  title: "Form In Modal Dialog",
} satisfies Meta;
export default meta;

export const FormInModalDialog: StoryObj = {
  render: () => <FormInModalDialogShowcase />,
};

const FormInModalDialogShowcase = () => (
  <ModalDialog
    defaultOpen
    footer={
      <>
        <ModalDialog.CloseButton variant="ghost">
          Cancel
        </ModalDialog.CloseButton>
        <Button form={FORM_ID} type="submit" variant="solid">
          Save changes
        </Button>
      </>
    }
    title="Edit profile"
    trigger={<Button size="xl">Edit profile</Button>}
  >
    <form
      className={formStyles}
      id={FORM_ID}
      onSubmit={(event) => {
        event.preventDefault();
      }}
    >
      <Field hint="Shown publicly on your profile." label="Display name">
        <Input
          defaultValue="Connor"
          placeholder="Your name"
          prefixIcon={<UserIcon />}
          type="text"
        />
      </Field>
      <Field hint="We will never share this address." label="Email">
        <Input
          defaultValue="connor@dourolabs.xyz"
          placeholder="you@example.com"
          prefixIcon={<EnvelopeIcon />}
          type="email"
        />
      </Field>
      <Field hint="Used for scheduling and timestamps." label="Timezone">
        <Select
          defaultValue="pt"
          options={TIMEZONE_OPTIONS}
          prefixIcon={<GlobeIcon />}
        />
      </Field>
      <Field
        hint="Controls who can find and view your profile."
        label="Visibility"
      >
        <Select defaultValue="public" options={VISIBILITY_OPTIONS} />
      </Field>
      <Field hint="A short paragraph about yourself." label="Bio">
        <Textarea
          defaultValue="Building things."
          placeholder="Tell us about yourself…"
          prefixIcon={<NotePencilIcon />}
          rows={4}
        />
      </Field>
    </form>
  </ModalDialog>
);

// Stable id used to associate the footer's submit Button (which lives
// outside the <form> element) with the form via the `form` attribute.
const FORM_ID = "form-in-modal-dialog-showcase";

const formStyles = flex({
  direction: "column",
  gap: 4,
});
