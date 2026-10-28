import { BluetoothIcon } from "@phosphor-icons/react/dist/ssr/Bluetooth";
import { EnvelopeSimpleIcon } from "@phosphor-icons/react/dist/ssr/EnvelopeSimple";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { css } from "../../styled-system/css";
import { Button } from "../Button/Button";
import { CountBadge } from "../CountBadge/CountBadge";

import { List, ListRow as ListRowComponent, SURFACES } from "./ListRow";

const meta = {
  args: {
    detail: "Battery 80%",
    end: (
      <Button size="xs" variant="primary">
        Disconnect
      </Button>
    ),
    icon: <BluetoothIcon size={15} weight="bold" />,
    label: "WH-1000XM4",
    surface: "filled",
  },
  argTypes: {
    children: { control: false, table: { category: "Contents" } },
    detail: { control: "text", table: { category: "Contents" } },
    end: { control: false, table: { category: "Contents" } },
    icon: { control: false, table: { category: "Contents" } },
    label: { control: "text", table: { category: "Contents" } },
    surface: {
      control: "inline-radio",
      options: SURFACES,
      table: { category: "Appearance" },
    },
  },
  component: ListRowComponent,
  decorators: [
    (Story) => (
      <div className={frameStyles}>
        <List>
          <Story />
        </List>
      </div>
    ),
  ],
  parameters: {
    docs: {
      description: {
        component:
          "One row of a panel's list: an icon, a label over a detail, and something at the end. Either one button, or a tile holding its own buttons.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Panels/ListRow",
} satisfies Meta<typeof ListRowComponent>;
export default meta;

export const Filled: StoryObj<typeof ListRowComponent> = {};

export const Pressable: StoryObj<typeof ListRowComponent> = {
  args: {
    detail: undefined,
    end: <CountBadge count={3} inline />,
    icon: <EnvelopeSimpleIcon size={15} weight="bold" />,
    label: "PrussinNet",
    name: "PrussinNet: 3 unread",
    onPress: () => undefined,
    surface: "plain",
  },
};

const frameStyles = css({ inlineSize: 88 });
