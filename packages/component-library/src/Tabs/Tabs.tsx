import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import type { ReactNode } from "react";

import { css, cva } from "../../styled-system/css";
import { flex } from "../../styled-system/patterns";
import type { ExtendProps } from "../extend-props";

/** The tab-bar text size and padding. `md` is the default. */
export const SIZES = ["sm", "md", "lg"] as const;
export type Size = (typeof SIZES)[number];

/** One tab: the `value` that identifies it, the `label` shown in the tab bar,
 *  and the `content` shown in its panel when active. */
export type TabItem = {
  value: string;
  label: ReactNode;
  content: ReactNode;
  disabled?: boolean | undefined;
};

// `orientation` is omitted: the styling here is horizontal-only (a bottom
// underline over a tab row), so we don't expose the vertical layout base-ui
// supports until there's styling for it. A vertical tab rail is its own widget.
type Props = Omit<
  ExtendProps<
    typeof BaseTabs.Root,
    {
      tabs: readonly TabItem[];
      size?: Size | undefined;
    }
  >,
  "orientation"
>;

/**
 * A tabbed container: a tab bar over one panel showing the active tab. Wraps the
 * `@base-ui/react` Tabs primitive, which owns the accessible behaviour — roving
 * tab focus, arrow-key navigation, `role="tab"`/`tabpanel"` wiring — so this
 * layer only supplies the domicile styling: a muted→accent active tab, a subtle
 * hover surface, and a soft accent `:focus-visible` fill (the global square
 * outline reads badly on a tab and on the panel). The active-tab underline is a
 * single `Tabs.Indicator` bar that slides — with a small `outBack` bounce —
 * between tabs as the selection changes, rather than a per-tab border. Every
 * other
 * `Tabs.Root` prop (`value`, `defaultValue`, `onValueChange`, …) passes
 * through. Inactive panels unmount, so hidden content holds no state and runs
 * no effects.
 */
export const Tabs = ({ tabs, size = "md", ...props }: Props) => (
  <BaseTabs.Root className={rootStyles} {...props}>
    <BaseTabs.List className={listStyles}>
      {tabs.map((tab) => (
        <BaseTabs.Tab
          className={tabStyles({ size })}
          disabled={tab.disabled ?? false}
          key={tab.value}
          value={tab.value}
        >
          {tab.label}
        </BaseTabs.Tab>
      ))}
      <BaseTabs.Indicator className={indicatorStyles} renderBeforeHydration />
    </BaseTabs.List>
    {tabs.map((tab) => (
      <BaseTabs.Panel
        className={panelStyles}
        keepMounted={false}
        key={tab.value}
        value={tab.value}
      >
        {tab.content}
      </BaseTabs.Panel>
    ))}
  </BaseTabs.Root>
);

const rootStyles = flex({
  blockSize: "100%",
  direction: "column",
  minBlockSize: 0,
});

const listStyles = flex({
  borderBlockEnd: "1px solid {colors.border}",
  direction: "row",
  gap: 1,
  // Anchors the absolutely-positioned indicator; base-ui measures the active
  // tab's offset relative to this element.
  position: "relative",
});

const tabStyles = cva({
  base: {
    _disabled: {
      cursor: "not-allowed",
      opacity: "disabled",
    },
    // Keyboard focus fills the tab with a soft accent wash (rounded by the
    // tab's own radius) rather than a ring or outline — the editor-tab-bar
    // idiom. The global square outline is hidden by forcing its colour
    // transparent, which beats its longhand declarations without fighting them.
    _focusVisible: {
      backgroundColor: "color-mix(in oklab, {colors.accent} 16%, transparent)",
      outlineColor: "transparent",
    },
    _selected: {
      color: "accent",
    },
    // Hover only lifts inactive, enabled tabs; the active tab keeps its accent.
    "&:not([data-selected])": {
      _hoverEnabled: {
        backgroundColor: "card",
        color: "foreground",
      },
    },
    background: "transparent",
    border: "none",
    borderRadius: "sm",
    color: "muted",
    cursor: "pointer",
    fontWeight: "medium",
    transition:
      "color {durations.fast} {easings.out}, background-color {durations.fast} {easings.out}",
  },
  variants: {
    size: {
      lg: { fontSize: "md", paddingBlock: 2, paddingInline: 4 },
      md: { fontSize: "sm", paddingBlock: 1.5, paddingInline: 3 },
      sm: { fontSize: "xs", paddingBlock: 1, paddingInline: 2.5 },
    },
  },
});

const indicatorStyles = css({
  "&[data-activation-direction=none]": {
    transition: "none",
  },
  backgroundColor: "accent",
  blockSize: "2px",
  inlineSize: "var(--active-tab-width)",
  // Sit on the list's 1px bottom border so the accent bar covers it.
  insetBlockEnd: "-1px",
  insetInlineStart: 0,
  position: "absolute",
  transform: "translateX(var(--active-tab-left))",
  // Slide + resize between tabs with a small overshoot for the bounce. No
  // animation on first paint (`none` direction) so the bar doesn't fly in.
  transition:
    "transform {durations.normal} {easings.outBack}, inline-size {durations.normal} {easings.outBack}",
});

const panelStyles = css({
  // A faint accent wash marks the focused panel rather than a ring or outline
  // around the whole content region; the global outline is hidden by forcing
  // its colour transparent.
  _focusVisible: {
    backgroundColor: "color-mix(in oklab, {colors.accent} 6%, transparent)",
    outlineColor: "transparent",
  },
  borderRadius: "sm",
  flex: 1,
  minBlockSize: 0,
});
