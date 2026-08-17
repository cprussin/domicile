import type { Meta, StoryObj } from "@storybook/react-vite";

import { Variants } from "../__test__/Variants";

import { ThemeProvider } from "./ThemeProvider";
import { ThemeSwitch } from "./ThemeSwitch";
import { THEME_PREFERENCES } from "./theme-core";

const meta = {
  component: ThemeSwitch,
  // The default (propless) usage reads the theme context, so mount a provider.
  decorators: [
    (Story) => (
      <ThemeProvider>
        <Story />
      </ThemeProvider>
    ),
  ],
  parameters: {
    docs: {
      description: {
        component:
          "A compact, three-state cycle toggle for theme selection (light → dark → system). Self-contained: it reads the current preference and the animated cycle from the theme context (supplied by the library `Provider`), so consumers just render `<ThemeSwitch />`. Three icons share a single round window; the active icon sits at center while the others are parked below.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Controls/ThemeSwitch",
} satisfies Meta<typeof ThemeSwitch>;
export default meta;

export const Default: StoryObj<typeof ThemeSwitch> = {};

export const AllPreferences: StoryObj<typeof ThemeSwitch> = {
  parameters: {
    docs: {
      description: {
        story:
          "The toggle's at-rest icon in each of its three preference states — light, dark, and system — side-by-side (the theme hook is stubbed per cell), so each can be compared at a glance.",
      },
    },
  },
  render: () => (
    <Variants columnLabel={(column) => column} columns={THEME_PREFERENCES}>
      {(preference) => (
        <ThemeSwitch
          useTheme={() => ({ cycle: () => undefined, preference })}
        />
      )}
    </Variants>
  ),
};
