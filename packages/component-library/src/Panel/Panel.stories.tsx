import type { Meta, StoryObj } from "@storybook/react-vite";
import { css } from "../../styled-system/css";
import { Button } from "../Button/Button";
import { DetailList } from "../DetailList/DetailList";
import { List, ListRow } from "../ListRow/ListRow";
import { PanelNote } from "../PanelNote/PanelNote";
import { PanelSection } from "../PanelSection/PanelSection";
import { Switch } from "../Switch/Switch";

import { PanelAction, Panel as PanelComponent, WIDTHS } from "./Panel";

const meta = {
  args: {
    children: (
      <>
        <PanelAction>
          <Switch checked label="Wi-Fi" />
        </PanelAction>
        <PanelSection label="Connected">
          <List>
            <ListRow
              detail="Strong signal · 5 GHz · 867 Mb/s"
              end={<Button size="xs">Disconnect</Button>}
              label="Home"
              surface="filled"
            >
              <DetailList
                rows={[
                  ["Address", "192.168.1.23/24"],
                  ["Gateway", "192.168.1.1"],
                ]}
              />
            </ListRow>
          </List>
        </PanelSection>
        <PanelSection label="Other networks">
          <List>
            <ListRow label="Upstairs 5G" onPress={() => undefined} />
            <ListRow label="Coffee Shop Guest" onPress={() => undefined} />
          </List>
          <PanelNote>Scanning…</PanelNote>
        </PanelSection>
      </>
    ),
    onBack: () => undefined,
    title: "Network",
    width: "standard",
  },
  argTypes: {
    children: { control: false, table: { category: "Contents" } },
    onBack: { action: "back", table: { category: "Events" } },
    title: { control: "text", table: { category: "Contents" } },
    width: {
      control: "inline-radio",
      options: WIDTHS,
      table: { category: "Appearance" },
    },
  },
  component: PanelComponent,
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
          "A titled panel: a header, then sections, lists and notes a step apart. Its content puts controls in the header with `PanelAction`.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Panels/Panel",
} satisfies Meta<typeof PanelComponent>;
export default meta;

export const Panel: StoryObj<typeof PanelComponent> = {};

const frameStyles = css({ maxInlineSize: 120 });
