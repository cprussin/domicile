import { KeyboardIcon } from "@phosphor-icons/react/dist/ssr/Keyboard";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { ChoiceList as ChoiceListComponent, RadioRow } from "./ChoiceRow";

const meta = {
  args: {
    "aria-label": "Keymap",
    defaultValue: "us",
  },
  component: ChoiceListComponent,
  parameters: {
    docs: {
      description: {
        component:
          "Rows of a pick list: an icon, a name and an optional detail, framed in the accent color while picked. Wraps the @base-ui/react RadioGroup, Radio and Checkbox primitives.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Forms & Inputs/ChoiceRow",
} satisfies Meta<typeof ChoiceListComponent>;
export default meta;

export const ChoiceList: StoryObj<typeof ChoiceListComponent> = {
  render: (props) => (
    <ChoiceListComponent {...props}>
      <RadioRow
        detail="English (programmer Dvorak)"
        icon={<KeyboardIcon weight="duotone" />}
        name="dvp"
        value="dvp"
      />
      <RadioRow
        detail="English (US)"
        icon={<KeyboardIcon weight="duotone" />}
        name="us"
        value="us"
      />
    </ChoiceListComponent>
  ),
};
