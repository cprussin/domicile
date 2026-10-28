import type { Meta, StoryObj } from "@storybook/react-vite";

import { LAYOUTS, Loading as LoadingComponent } from "./Loading";

const meta = {
  args: {
    children: "Checking Wi-Fi…",
    layout: "panel",
  },
  argTypes: {
    children: { control: "text", table: { category: "Contents" } },
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
          "A spinner and what it is waiting for: centered in a waiting panel, on one line under a list, or alone at a row's end.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Panels/Loading",
} satisfies Meta<typeof LoadingComponent>;
export default meta;

export const Panel: StoryObj<typeof LoadingComponent> = {};

export const Row: StoryObj<typeof LoadingComponent> = {
  args: { children: "Looking for devices…", layout: "row" },
};

export const Glyph: StoryObj<typeof LoadingComponent> = {
  args: { children: "Checking", layout: "glyph" },
};
