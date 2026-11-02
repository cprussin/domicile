import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { css } from "../../styled-system/css";
import { Button } from "../Button/Button";
import { FluidItem as FluidItemComponent } from "./FluidItem";

const meta = {
  args: {
    children: undefined,
    gap: "wide",
  },
  argTypes: {
    gap: {
      control: "inline-radio",
      options: ["none", "narrow", "wide"],
      table: { category: "Appearance" },
    },
  },
  component: FluidItemComponent,
  parameters: {
    docs: {
      description: {
        component:
          "An item in a row that opens, follows and closes with its content, fading in and out. Wrap anything that comes and goes or changes width.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Layout/FluidItem",
} satisfies Meta<typeof FluidItemComponent>;
export default meta;

const WORDS = ["Downloads", "Downloading 3 files", undefined] as const;

export const FluidItem: StoryObj<typeof FluidItemComponent> = {
  render: function Render(props) {
    const [step, setStep] = useState(0);
    const words = WORDS[step % WORDS.length];
    return (
      <span
        className={css({ display: "flex", flexDirection: "column", gap: 4 })}
      >
        <span
          className={css({
            alignItems: "center",
            display: "flex",
            marginInline: -2,
          })}
        >
          <FluidItemComponent gap={props.gap}>A</FluidItemComponent>
          <FluidItemComponent gap={props.gap}>{words}</FluidItemComponent>
          <FluidItemComponent gap={props.gap}>B</FluidItemComponent>
        </span>
        <Button
          onClick={() => {
            setStep((current) => current + 1);
          }}
        >
          Next
        </Button>
      </span>
    );
  },
};
