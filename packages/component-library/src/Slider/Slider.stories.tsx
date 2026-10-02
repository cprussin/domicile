import type { Meta, StoryObj } from "@storybook/react-vite";

import { css } from "../../styled-system/css";
import { Slider as SliderComponent } from "./Slider";

const meta = {
  args: {
    defaultValue: 60,
    disabled: false,
    label: "Brightness",
    max: 100,
    min: 0,
    step: 1,
  },
  argTypes: {
    defaultValue: {
      control: { max: 100, min: 0, type: "range" },
      table: { category: "State" },
    },
    disabled: {
      control: "boolean",
      table: { category: "State" },
    },
    label: {
      control: "text",
      table: { category: "Contents" },
    },
    max: {
      control: "number",
      table: { category: "Range" },
    },
    min: {
      control: "number",
      table: { category: "Range" },
    },
    onValueChange: {
      control: false,
      table: { category: "Events" },
    },
    onValueCommitted: {
      control: false,
      table: { category: "Events" },
    },
    step: {
      control: "number",
      table: { category: "Range" },
    },
    value: {
      control: { max: 100, min: 0, type: "range" },
      table: { category: "State" },
    },
  },
  component: SliderComponent,
  decorators: [
    (Story) => (
      <div className={frameStyles}>
        <Story />
      </div>
    ),
  ],
  parameters: {
    docs: {
      description: {
        component:
          "One value picked off a range, as a fat pill whose fill runs to a knob riding inside it. Wraps the @base-ui/react Slider primitive.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Forms & Inputs/Slider",
} satisfies Meta<typeof SliderComponent>;
export default meta;

export const Slider: StoryObj<typeof SliderComponent> = {
  args: {
    defaultValue: 60,
    disabled: false,
  },
};

export const Disabled: StoryObj<typeof SliderComponent> = {
  args: {
    defaultValue: 30,
    disabled: true,
  },
};

// A width to fill: the pill is as wide as whatever holds it.
const frameStyles = css({ inlineSize: 64 });
