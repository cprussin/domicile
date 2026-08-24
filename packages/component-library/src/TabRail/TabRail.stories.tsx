import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { css } from "../../styled-system/css";
import { Button } from "../Button/Button";
import type { DropPosition, TabRailTab } from "./TabRail";
import { TabRail } from "./TabRail";

const INITIAL: TabRailTab[] = [
  { id: "a", label: "Welcome" },
  { id: "b", label: "Notes" },
  { id: "c", label: "Q3 earnings call transcript" },
];

const reorder = (
  tabs: readonly TabRailTab[],
  fromId: string,
  toId: string,
  position: DropPosition,
): TabRailTab[] => {
  const from = tabs.find((tab) => tab.id === fromId);
  const without = tabs.filter((tab) => tab.id !== fromId);
  const to = without.findIndex((tab) => tab.id === toId);
  if (from === undefined || to === -1) {
    return [...tabs];
  }
  const at = position === "before" ? to : to + 1;
  return [...without.slice(0, at), from, ...without.slice(at)];
};

// The rail is controlled (activeId + callbacks), so the story owns the state it
// drives: selecting, closing, opening, and reordering all flow back through
// `setTabs`/`setActiveId`, the way an app's controller would.
const Demo = () => {
  const [tabs, setTabs] = useState<TabRailTab[]>(INITIAL);
  const [activeId, setActiveId] = useState("a");
  const [minted, setMinted] = useState(0);

  return (
    <div className={frameStyles}>
      <TabRail
        activeId={activeId}
        brand={<strong>Domicile</strong>}
        footer={
          <>
            <Button size="sm" variant="ghost">
              History
            </Button>
            <Button size="sm" variant="ghost">
              Settings
            </Button>
          </>
        }
        onClose={(id) => {
          setTabs((current) => current.filter((tab) => tab.id !== id));
        }}
        onNew={() => {
          const id = `tab-${String(minted)}`;
          setMinted((n) => n + 1);
          setTabs((current) => [...current, { id, label: "New Tab" }]);
          setActiveId(id);
        }}
        onReorder={(fromId, toId, position) => {
          setTabs((current) => reorder(current, fromId, toId, position));
        }}
        onSelect={setActiveId}
        tabs={tabs}
      />
      <div className={contentStyles}>
        Active tab: <code>{activeId}</code>
      </div>
    </div>
  );
};

const noop = () => undefined;

const meta = {
  args: {
    activeId: "a",
    brand: undefined,
    footer: undefined,
    onClose: noop,
    onNew: noop,
    onReorder: noop,
    onSelect: noop,
    tabs: INITIAL,
  },
  argTypes: {
    activeId: {
      control: "select",
      options: INITIAL.map((tab) => tab.id),
      table: { category: "State" },
    },
    brand: {
      control: false,
      table: { category: "Contents" },
    },
    footer: {
      control: false,
      table: { category: "Contents" },
    },
    onClose: {
      action: "close",
      table: { category: "Events" },
    },
    onNew: {
      action: "new",
      table: { category: "Events" },
    },
    onReorder: {
      action: "reorder",
      table: { category: "Events" },
    },
    onSelect: {
      action: "select",
      table: { category: "Events" },
    },
    tabs: {
      control: false,
      table: { category: "Contents" },
    },
  },
  component: TabRail,
  parameters: {
    docs: {
      description: {
        component:
          "A vertical rail of tabs — the sidebar counterpart to the horizontal Tabs bar. Presentational and controlled (activeId + callbacks): a row per tab with select and gated close (by its close button or a middle-click on the row), drag and Alt+Arrow / Alt+Shift+Arrow reordering, a header pairing an app brand with a built-in new-tab button, and an optional footer for app chrome.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Navigation/TabRail",
} satisfies Meta<typeof TabRail>;
export default meta;

export const Default: StoryObj<typeof meta> = {
  render: () => <Demo />,
};

const frameStyles = css({
  blockSize: "100dvh",
  color: "foreground",
  display: "flex",
});

const contentStyles = css({ color: "muted", fontSize: "sm", padding: 6 });
