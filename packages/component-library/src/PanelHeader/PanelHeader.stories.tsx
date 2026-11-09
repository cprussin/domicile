import type { Meta, StoryObj } from "@storybook/react-vite";
import { css } from "../../styled-system/css";
import { Switch } from "../Switch/Switch";

import { PanelHeader as PanelHeaderComponent } from "./PanelHeader";

const meta = {
  args: {
    action: <Switch checked hideLabel label="Bluetooth" />,
    onBack: () => undefined,
    status: undefined,
    title: "Bluetooth",
  },
  argTypes: {
    action: { control: false, table: { category: "Contents" } },
    onBack: { action: "back", table: { category: "Events" } },
    status: { control: "text", table: { category: "Contents" } },
    title: { control: "text", table: { category: "Contents" } },
  },
  component: PanelHeaderComponent,
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
          "A panel's title, with a back button when it is one level in, and its controls at the end.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Panels/PanelHeader",
} satisfies Meta<typeof PanelHeaderComponent>;
export default meta;

export const PanelHeader: StoryObj<typeof PanelHeaderComponent> = {};

export const TitleOnly: StoryObj<typeof PanelHeaderComponent> = {
  args: { action: undefined, onBack: undefined, title: "Notifications" },
};

export const WithStatus: StoryObj<typeof PanelHeaderComponent> = {
  args: {
    action: undefined,
    onBack: undefined,
    status: "Paused until 3:00 PM",
    title: "Notifications",
  },
};

const frameStyles = css({ inlineSize: 88 });
