import type { Meta, StoryObj } from "@storybook/react-vite";

import { Variants } from "../__test__/Variants";
import type { TabItem } from "./Tabs";
import { SIZES, Tabs as TabsComponent } from "./Tabs";

const TABS: readonly TabItem[] = [
  {
    content: <p>Everything at a glance — the default landing tab.</p>,
    label: "Overview",
    value: "overview",
  },
  {
    content: <p>Recent activity for this surface.</p>,
    label: "Activity",
    value: "activity",
  },
  {
    content: <p>Preferences and configuration.</p>,
    label: "Settings",
    value: "settings",
  },
  {
    content: <p>Nothing here — this tab is disabled.</p>,
    disabled: true,
    label: "Archived",
    value: "archived",
  },
];

const VALUES = TABS.map((tab) => tab.value);

const meta = {
  args: {
    defaultValue: "overview",
    size: "md",
    tabs: TABS,
    value: undefined,
  },
  argTypes: {
    defaultValue: {
      control: "select",
      options: VALUES,
      table: { category: "State" },
    },
    onValueChange: {
      action: "valueChange",
      table: { category: "Events" },
    },
    size: {
      control: "inline-radio",
      options: SIZES,
      table: { category: "Appearance" },
    },
    tabs: {
      control: false,
      table: { category: "Contents" },
    },
    value: {
      control: "select",
      options: VALUES,
      table: { category: "State" },
    },
  },
  component: TabsComponent,
  parameters: {
    docs: {
      description: {
        component:
          "A tabbed container wrapping the @base-ui/react Tabs primitive: a labeled tab bar over one panel showing the active tab, with roving keyboard focus, an accent underline that slides between tabs, a subtle hover surface, and a soft accent focus fill.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Navigation/Tabs",
} satisfies Meta<typeof TabsComponent>;
export default meta;

export const Tabs: StoryObj<typeof TabsComponent> = {
  args: {
    defaultValue: "overview",
    size: "md",
    value: undefined,
  },
};

export const Controlled: StoryObj<typeof TabsComponent> = {
  args: {
    defaultValue: undefined,
    size: "md",
    value: "activity",
  },
  parameters: {
    docs: {
      description: {
        story:
          "Driven by `value` + `onValueChange` — the active tab is pinned by the control rather than base-ui's internal state.",
      },
    },
  },
};

export const AllSizes: StoryObj<typeof TabsComponent> = {
  args: {
    defaultValue: "overview",
    value: undefined,
  },
  parameters: {
    controls: { exclude: ["size"] },
  },
  // Sizes stacked vertically (one per row), since each Tabs is a full-width
  // bar-over-panel that reads better down a column than squeezed side by side.
  render: ({ size: _size, ...props }) => (
    <Variants rowLabel={(size) => size} rows={SIZES}>
      {(size) => <TabsComponent size={size} {...props} />}
    </Variants>
  ),
};
