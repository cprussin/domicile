import { EyeIcon } from "@phosphor-icons/react/dist/ssr/Eye";
import { MoonIcon } from "@phosphor-icons/react/dist/ssr/Moon";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { css } from "../../styled-system/css";

import { QuickToggle as QuickToggleComponent } from "./QuickToggle";

const meta = {
  args: {
    icon: <MoonIcon size={16} weight="bold" />,
    label: "Night light",
    onPressedChange: () => undefined,
    pressed: true,
  },
  component: QuickToggleComponent,
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
          "A quick settings switch for something turned on and off often: an icon in a circle, in the accent color while on, over its label.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Forms & Inputs/QuickToggle",
} satisfies Meta<typeof QuickToggleComponent>;
export default meta;

export const On: StoryObj<typeof QuickToggleComponent> = {};

export const Off: StoryObj<typeof QuickToggleComponent> = {
  args: {
    detail: "Kept on by Firefox",
    icon: <EyeIcon size={16} weight="bold" />,
    label: "Keep awake",
    pressed: false,
  },
};

const frameStyles = css({ display: "flex", inlineSize: 28 });
