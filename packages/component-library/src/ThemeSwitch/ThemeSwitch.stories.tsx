import type { Meta, StoryObj } from "@storybook/react-vite";

import { Variants } from "../__test__/Variants";

import { standaloneThemeSource } from "./standalone-theme-source";
import { ThemeProvider } from "./ThemeProvider";
import { ThemeSwitch } from "./ThemeSwitch";
import { THEMES } from "./theme-core";

const meta = {
  component: ThemeSwitch,
  // The default (propless) usage reads the theme context, so mount a provider.
  // Storybook has no desktop behind it, so the source answers its own request.
  decorators: [
    (Story) => (
      <ThemeProvider source={standaloneThemeSource()}>
        <Story />
      </ThemeProvider>
    ),
  ],
  parameters: {
    docs: {
      description: {
        component:
          "A two-state toggle for the desktop's theme (dark ⇄ light). There is no third position: this dresses Domicile's own chrome, and there is nothing above Domicile whose preference a `system` could follow. Self-contained — it reads the theme and the flip from the theme context (supplied by the library `Provider`), so consumers just render `<ThemeSwitch />`. Two icons share a single round window; the active icon sits at center while the other is parked below.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Controls/ThemeSwitch",
} satisfies Meta<typeof ThemeSwitch>;
export default meta;

export const Default: StoryObj<typeof ThemeSwitch> = {};

export const BothThemes: StoryObj<typeof ThemeSwitch> = {
  parameters: {
    docs: {
      description: {
        story:
          "The toggle's at-rest icon in each of its two states — dark and light — side by side (the theme hook is stubbed per cell), so the pair can be compared at a glance.",
      },
    },
  },
  render: () => (
    <Variants columnLabel={(column) => column} columns={THEMES}>
      {(theme) => (
        <ThemeSwitch useTheme={() => ({ flip: () => undefined, theme })} />
      )}
    </Variants>
  ),
};
