import type { Meta, StoryObj } from "@storybook/react-vite";
import { css } from "../../styled-system/css";
import { List, ListRow } from "../ListRow/ListRow";

import { PanelSection as PanelSectionComponent } from "./PanelSection";

const meta = {
  args: {
    children: (
      <List>
        <ListRow label="PrussinNet" onPress={() => undefined} />
        <ListRow label="Messages" onPress={() => undefined} />
      </List>
    ),
    label: "Inboxes",
  },
  argTypes: {
    action: { control: false, table: { category: "Contents" } },
    children: { control: false, table: { category: "Contents" } },
    label: { control: "text", table: { category: "Contents" } },
  },
  component: PanelSectionComponent,
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
          "A group in a panel, under a small label. Sections sit a step apart, so the labels do the grouping.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Panels/PanelSection",
} satisfies Meta<typeof PanelSectionComponent>;
export default meta;

export const PanelSection: StoryObj<typeof PanelSectionComponent> = {};

const frameStyles = css({ inlineSize: 88 });
