import type { ReactNode } from "react";
import { createContext, useContext, useState } from "react";
import { createPortal } from "react-dom";

import { css, cva } from "../../styled-system/css";
import { flex } from "../../styled-system/patterns";
import { PanelHeader } from "../PanelHeader/PanelHeader";
import "../stylesheet";

type Props = {
  /** Sections, lists and notes, a step apart. */
  children: ReactNode;
  /** Shows a back button that calls it. */
  onBack?: (() => void) | undefined;
  title: string;
  /**
   * `fill` takes its container's width; `standard` is a popover's usual
   * width, for a panel whose content would otherwise size it.
   */
  width?: Width | undefined;
};

export const WIDTHS = ["fill", "standard"] as const;
export type Width = (typeof WIDTHS)[number];

/**
 * Where the content's {@link PanelAction} draws: the header's end, once it
 * is in the page. `undefined` outside a panel.
 */
const ActionSlot = createContext<HTMLElement | null | undefined>(undefined);

/**
 * A titled panel, such as a bar item's popover or a detail drilled into: a
 * `PanelHeader`, then its content in a column, a step apart. The content
 * puts controls in the header with {@link PanelAction}.
 *
 */
export const Panel = ({ children, onBack, title, width = "fill" }: Props) => {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return (
    <div className={panelStyles({ width })} data-width={width}>
      <PanelHeader
        action={<span className={slotStyles} ref={setSlot} />}
        onBack={onBack}
        title={title}
      />
      <ActionSlot.Provider value={slot}>{children}</ActionSlot.Provider>
    </div>
  );
};

/**
 * Controls for the panel's header, such as its switch, drawn beside its
 * title. Outside a `Panel` they stay where they are.
 */
export const PanelAction = ({ children }: { children: ReactNode }) => {
  const slot = useContext(ActionSlot);
  if (slot === undefined) {
    return children;
  } else if (slot === null) {
    return undefined;
  } else {
    return createPortal(children, slot);
  }
};

const panelStyles = cva({
  base: flex.raw({ direction: "column", gap: 3, minInlineSize: 0 }),
  variants: {
    width: {
      fill: {},
      standard: { inlineSize: 88, maxInlineSize: "100%" },
    },
  },
});

const slotStyles = css({
  _empty: { display: "none" },
  alignItems: "center",
  display: "inline-flex",
  gap: 2,
});
