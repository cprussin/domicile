import { preset as presetPanda } from "@pandacss/preset-panda";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { css } from "../../styled-system/css";
import type { FontSizeToken } from "../../styled-system/tokens";
import { Variants } from "../__test__/Variants";

import { Kbd as KbdComponent } from "./Kbd";

const FONT_SIZES = Object.keys(
  presetPanda.theme.tokens.fontSizes ?? {},
) as FontSizeToken[];

const meta = {
  args: {
    children: "Enter",
  },
  argTypes: {
    children: {
      control: "text",
      table: { category: "Contents" },
    },
  },
  component: KbdComponent,
  parameters: {
    docs: {
      description: {
        component:
          "A small monospaced chip for representing a single key or key combination in hint text.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Data Display/Kbd",
} satisfies Meta<typeof KbdComponent>;
export default meta;

export const Kbd: StoryObj<typeof KbdComponent> = {
  args: {
    children: "Enter",
  },
};

export const Combination: StoryObj<typeof KbdComponent> = {
  parameters: {
    controls: { exclude: ["children"] },
  },
  render: (props) => (
    <span>
      Press <KbdComponent {...props}>Shift</KbdComponent>
      {" + "}
      <KbdComponent {...props}>Enter</KbdComponent> for a newline.
    </span>
  ),
};

export const AllVariations: StoryObj<typeof KbdComponent> = {
  args: {
    children: "Enter",
  },
  parameters: {
    docs: {
      description: {
        story:
          "Kbd embedded in body text at every `fontSize` token defined by the preset, so you can verify the chip stays proportional across the full type scale.",
      },
    },
  },
  render: (props) => (
    <Variants rowLabel={(row) => row} rows={FONT_SIZES}>
      {(size) => (
        <span className={css({ fontSize: size })}>
          Press <KbdComponent {...props} /> to go
        </span>
      )}
    </Variants>
  ),
};
