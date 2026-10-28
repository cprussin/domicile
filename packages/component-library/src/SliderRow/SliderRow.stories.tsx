import { LightbulbFilamentIcon } from "@phosphor-icons/react/dist/ssr/LightbulbFilament";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { css } from "../../styled-system/css";
import { Slider } from "../Slider/Slider";

import { SliderRow as SliderRowComponent } from "./SliderRow";

const meta = {
  args: {
    children: <Slider defaultValue={70} label="Brightness" max={100} min={0} />,
    figure: "70%",
    lead: <LightbulbFilamentIcon aria-hidden size={14} />,
  },
  argTypes: {
    children: { control: false, table: { category: "Contents" } },
    end: { control: false, table: { category: "Contents" } },
    figure: { control: "text", table: { category: "Contents" } },
    lead: { control: false, table: { category: "Contents" } },
  },
  component: SliderRowComponent,
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
          "A slider in a row: what it sets, the slider, its value and optionally a button. Stacked rows line up.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Panels/SliderRow",
} satisfies Meta<typeof SliderRowComponent>;
export default meta;

export const SliderRow: StoryObj<typeof SliderRowComponent> = {};

const frameStyles = css({ inlineSize: 88 });
