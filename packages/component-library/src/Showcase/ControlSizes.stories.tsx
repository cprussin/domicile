import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/ssr/MagnifyingGlass";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Variants } from "../__test__/Variants";
import { Button } from "../Button/Button";
import type { Size } from "../control-sizes";
import { SIZES } from "../control-sizes";
import { Input } from "../Input/Input";
import type { SelectOption } from "../Select/Select";
import { Select } from "../Select/Select";
import { Textarea } from "../Textarea/Textarea";

const CONTROL_TYPES = ["Button", "Input", "Select", "Textarea"] as const;
type ControlType = (typeof CONTROL_TYPES)[number];

const SELECT_OPTIONS: readonly SelectOption<string>[] = [
  { label: "Sans-serif", value: "sans" },
  { label: "Serif", value: "serif" },
  { label: "Monospace", value: "mono" },
];

const meta = {
  parameters: {
    docs: {
      description: {
        component:
          "Buttons, Inputs, Selects, and Textareas share the same `control` size recipe, so they line up cleanly when composed together in forms.",
      },
    },
    options: { showPanel: false },
  },
  title: "Control Sizes",
} satisfies Meta;
export default meta;

export const ControlSizes: StoryObj = {
  render: () => <ControlSizesShowcase />,
};

const ControlSizesShowcase = () => (
  <Variants
    columnLabel={(column) => column}
    columns={CONTROL_TYPES}
    rowLabel={(row) => row}
    rows={SIZES}
  >
    {renderControl}
  </Variants>
);

const renderControl = (size: Size, controlType: ControlType) => {
  switch (controlType) {
    case "Button": {
      return (
        <Button size={size} variant="outline">
          {buttonLabelForSize(size)}
        </Button>
      );
    }
    case "Input": {
      return (
        <Input
          placeholder="Search…"
          prefixIcon={<MagnifyingGlassIcon />}
          size={size}
          width={48}
        />
      );
    }
    case "Select": {
      return (
        <Select
          defaultValue="sans"
          options={SELECT_OPTIONS}
          size={size}
          width={48}
        />
      );
    }
    case "Textarea": {
      return (
        <Textarea
          placeholder="Notes…"
          prefixIcon={<MagnifyingGlassIcon />}
          rows={1}
          size={size}
          width={48}
        />
      );
    }
  }
};

const buttonLabelForSize = (size: Size) => {
  switch (size) {
    case "xs": {
      return "Save";
    }
    case "sm": {
      return "Submit";
    }
    case "md": {
      return "Continue";
    }
    case "lg": {
      return "Apply changes";
    }
    case "xl": {
      return "Get started";
    }
    case "2xl": {
      return "Launch now";
    }
    case "3xl": {
      return "Make it real";
    }
    case "4xl": {
      return "Ship it";
    }
  }
};
