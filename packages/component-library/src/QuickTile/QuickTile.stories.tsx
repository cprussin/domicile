import { BluetoothIcon } from "@phosphor-icons/react/dist/ssr/Bluetooth";
import { MoonIcon } from "@phosphor-icons/react/dist/ssr/Moon";
import { NetworkIcon } from "@phosphor-icons/react/dist/ssr/Network";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { css } from "../../styled-system/css";

import { QuickTile as QuickTileComponent } from "./QuickTile";

const meta = {
  args: {
    detail: "WH-1000XM4",
    icon: <BluetoothIcon size={15} weight="bold" />,
    label: "Bluetooth",
    onMore: () => undefined,
    onPressedChange: () => undefined,
    pressed: true,
  },
  component: QuickTileComponent,
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
          "A quick settings tile: a labeled toggle, in the accent color while on, with an arrow to its details.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Forms & Inputs/QuickTile",
} satisfies Meta<typeof QuickTileComponent>;
export default meta;

export const On: StoryObj<typeof QuickTileComponent> = {};

export const Off: StoryObj<typeof QuickTileComponent> = {
  args: {
    detail: "Starts at sunset",
    icon: <MoonIcon size={15} weight="bold" />,
    label: "Night light",
    onMore: undefined,
    pressed: false,
  },
};

export const DetailsOnly: StoryObj<typeof QuickTileComponent> = {
  args: {
    detail: "Connected, 1 Gb/s",
    icon: <NetworkIcon size={15} weight="bold" />,
    label: "Wired",
    onPressedChange: undefined,
    pressed: undefined,
  },
};

const frameStyles = css({ inlineSize: 40 });
