import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/dist/ssr/ClockCounterClockwise";
import { GlobeSimpleIcon } from "@phosphor-icons/react/dist/ssr/GlobeSimple";
import { LockIcon } from "@phosphor-icons/react/dist/ssr/Lock";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/ssr/MagnifyingGlass";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { iconControl } from "../__test__/iconControl";
import { invalidDecorator } from "../__test__/invalidDecorator";
import { Button } from "../Button/Button";
import type { Suggestion } from "./Autocomplete";
import { Autocomplete as AutocompleteComponent, SIZES } from "./Autocomplete";

const VISITED: readonly Suggestion<string>[] = [
  {
    description: "Visited",
    icon: <ClockCounterClockwiseIcon />,
    label: "news.ycombinator.com",
    text: "https://news.ycombinator.com",
    value: "https://news.ycombinator.com",
  },
  {
    description: "Visited",
    icon: <ClockCounterClockwiseIcon />,
    label: "base-ui.com/react/components/autocomplete",
    text: "https://base-ui.com/react/components/autocomplete",
    value: "https://base-ui.com/react/components/autocomplete",
  },
  {
    description: "Search",
    icon: <MagnifyingGlassIcon />,
    label: "news about wayland",
    text: "news about wayland",
    value: "https://google.com/search?q=news%20about%20wayland",
  },
];

const meta = {
  args: {
    autoHighlight: false,
    disabled: false,
    emptyMessage: "Nothing to suggest",
    placeholder: "Search or enter an address",
    prefixIcon: <GlobeSimpleIcon />,
    rounded: false,
    size: "md",
    suggestions: VISITED,
    width: 96,
  },
  argTypes: {
    autoHighlight: {
      control: "boolean",
      table: { category: "State" },
    },
    disabled: {
      control: "boolean",
      table: { category: "State" },
    },
    emptyMessage: {
      control: "text",
      table: { category: "Contents" },
    },
    placeholder: {
      control: "text",
      table: { category: "Contents" },
    },
    prefixButtons: {
      control: false,
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
    suffixButtons: {
      control: false,
      table: { category: "Contents" },
    },
    suggestions: {
      control: false,
      table: { category: "Contents" },
    },
    width: {
      control: "number",
      table: { category: "Style" },
    },
  },
  component: AutocompleteComponent,
  parameters: {
    docs: {
      description: {
        component:
          "A text field with a list of suggestions under it, wrapping the @base-ui/react Autocomplete primitive. Shares the `control` recipe and `wrapperBase` state matrix with Input, Textarea and Select. The caller decides which lines to offer and in what order — the field does no matching of its own — so the list can rank and can offer a line that matches nothing typed, which is what an address bar's search row is.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Forms & Inputs/Autocomplete",
} satisfies Meta<typeof AutocompleteComponent<string>>;
export default meta;

export const Autocomplete: StoryObj<typeof AutocompleteComponent<string>> = {
  args: {
    autoHighlight: false,
    disabled: false,
    rounded: false,
    size: "md",
  },
};

export const Rounded = {
  args: {
    autoHighlight: false,
    disabled: false,
    rounded: true,
    size: "md",
  },
} satisfies StoryObj<typeof AutocompleteComponent<string>>;

export const Disabled = {
  args: {
    autoHighlight: false,
    disabled: true,
    rounded: false,
    size: "md",
  },
} satisfies StoryObj<typeof AutocompleteComponent<string>>;

export const NothingToSuggest = {
  args: {
    autoHighlight: false,
    disabled: false,
    rounded: false,
    size: "md",
    suggestions: [],
  },
  parameters: {
    docs: {
      description: {
        story:
          "Type into the field to see the `emptyMessage` in place of a list.",
      },
    },
  },
} satisfies StoryObj<typeof AutocompleteComponent<string>>;

export const Invalid = {
  args: {
    autoHighlight: false,
    disabled: false,
    rounded: false,
    size: "md",
  },
  decorators: [invalidDecorator],
  parameters: {
    docs: {
      description: {
        story:
          "Inside an invalid `Field`, the prefix icon swaps for the warning indicator and the border turns — the same matrix Input uses.",
      },
    },
  },
} satisfies StoryObj<typeof AutocompleteComponent<string>>;

export const Controlled = {
  args: {
    autoHighlight: true,
    disabled: false,
    rounded: false,
    size: "md",
  },
  parameters: {
    docs: {
      description: {
        story:
          "What a consumer actually writes: the field's text is the caller's state, and taking a suggestion writes it back. `autoHighlight` is on, so the first line fills the field as the user types and Enter takes it.",
      },
    },
  },
  render: (args) => <ControlledField {...args} />,
} satisfies StoryObj<typeof AutocompleteComponent<string>>;

const ControlledField = (
  args: Parameters<typeof AutocompleteComponent<string>>[0],
) => {
  const [value, setValue] = useState("");
  return (
    <AutocompleteComponent
      {...args}
      onSuggestionTaken={setValue}
      onValueChange={setValue}
      value={value}
    />
  );
};

export const WithAControlAtTheStart = {
  args: {
    autoHighlight: false,
    disabled: false,
    prefixButtons: (
      <Button label="Connection is encrypted" size="sm" variant="ghost">
        <LockIcon />
      </Button>
    ),
    prefixIcon: undefined,
    rounded: true,
    size: "md",
  },
  parameters: {
    docs: {
      description: {
        story:
          "`prefixButtons` in place of `prefixIcon`: the icon slot takes no pointer — it is what the invalid indicator animates in and out of — so a control at that end of the field goes here instead. This is what a browser's site indicator is.",
      },
    },
  },
} satisfies StoryObj<typeof AutocompleteComponent<string>>;
