import { WifiHighIcon } from "@phosphor-icons/react/dist/ssr/WifiHigh";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { LAYOUTS, Loading as LoadingComponent } from "./Loading";

const meta = {
  args: {
    children: "Checking Wi-Fi…",
    layout: "panel",
  },
  argTypes: {
    children: { control: "text", table: { category: "Contents" } },
    icon: { control: false, table: { category: "Contents" } },
    layout: {
      control: "inline-radio",
      options: LAYOUTS,
      table: { category: "Appearance" },
    },
  },
  component: LoadingComponent,
  parameters: {
    docs: {
      description: {
        component:
          "What a panel is waiting for: a spinner over its words, what it is searching for with rings spreading out from it, or a spinner alone at a row's end.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Panels/Loading",
} satisfies Meta<typeof LoadingComponent>;
export default meta;

export const Panel: StoryObj<typeof LoadingComponent> = {};

export const Searching: StoryObj<typeof LoadingComponent> = {
  args: { children: "Looking for networks…", icon: WifiHighIcon },
};

export const Glyph: StoryObj<typeof LoadingComponent> = {
  args: { children: "Checking", layout: "glyph" },
};
