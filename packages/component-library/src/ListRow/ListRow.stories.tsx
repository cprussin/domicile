import { BluetoothIcon } from "@phosphor-icons/react/dist/ssr/Bluetooth";
import { EnvelopeSimpleIcon } from "@phosphor-icons/react/dist/ssr/EnvelopeSimple";
import { WifiHighIcon } from "@phosphor-icons/react/dist/ssr/WifiHigh";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { css } from "../../styled-system/css";
import { Button } from "../Button/Button";
import { CountBadge } from "../CountBadge/CountBadge";
import { DetailList } from "../DetailList/DetailList";
import { PanelFooter } from "../PanelFooter/PanelFooter";

import { List, ListRow as ListRowComponent, SURFACES } from "./ListRow";

const meta = {
  args: {
    detail: "Battery 80%",
    disclosure: undefined,
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
    disclosure: { control: "text", table: { category: "Contents" } },
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

export const WithDetails: StoryObj<typeof ListRowComponent> = {
  args: {
    children: (
      <>
        <DetailList
          rows={[
            ["Speed", "866 Mb/s"],
            ["IPv4 address", "192.168.1.42/24"],
            ["Interface", "wlan0"],
          ]}
        />
        <PanelFooter
          action={
            <Button rounded size="xs" variant="ghost">
              Disconnect
            </Button>
          }
        />
      </>
    ),
    detail: "Connected · Good signal · 5 GHz",
    disclosure: "Details",
    end: undefined,
    icon: <WifiHighIcon size={15} weight="bold" />,
    label: "Goodbody Home",
  },
};

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
