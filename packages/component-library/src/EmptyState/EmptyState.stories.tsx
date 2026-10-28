import { BellSimpleIcon } from "@phosphor-icons/react/dist/ssr/BellSimple";
import { WifiSlashIcon } from "@phosphor-icons/react/dist/ssr/WifiSlash";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { EmptyState as EmptyStateComponent } from "./EmptyState";

const meta = {
  args: {
    hint: "Turn it on to see networks nearby.",
    icon: WifiSlashIcon,
    title: "Wi-Fi is off",
  },
  argTypes: {
    hint: { control: "text", table: { category: "Contents" } },
    icon: { control: false, table: { category: "Contents" } },
    title: { control: "text", table: { category: "Contents" } },
  },
  component: EmptyStateComponent,
  parameters: {
    docs: {
      description: {
        component:
          "A panel with nothing to show: an icon, what is missing, and what would fill it, in plain words.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Panels/EmptyState",
} satisfies Meta<typeof EmptyStateComponent>;
export default meta;

export const WithHint: StoryObj<typeof EmptyStateComponent> = {};

export const TitleOnly: StoryObj<typeof EmptyStateComponent> = {
  args: {
    hint: undefined,
    icon: BellSimpleIcon,
    title: "You're all caught up",
  },
};
