import { BarContext } from "@domicile-desktop/manganese-bar/bar-context";
import { PanelKeyboardContext } from "@domicile-desktop/manganese-bar/panel-keyboard";
import type { ReactNode } from "react";

import { css } from "../styled-system/css";

const BAR = { locked: false, popsUp: false, screen: "laptop" };

/** The keyboard stays on the page: there is no window to take it. */
const holdKeyboard = () => () => undefined;

/** A bar along the top of the screen, holding `children` at its end. */
export const Bar = ({ children }: { children: ReactNode }) => (
  <BarContext value={BAR}>
    <PanelKeyboardContext value={holdKeyboard}>
      <div className={barStyles}>{children}</div>
    </PanelKeyboardContext>
  </BarContext>
);

const barStyles = css({
  alignItems: "center",
  backgroundColor: "gray.700",
  blockSize: 8,
  color: "white",
  display: "flex",
  gap: 2,
  justifyContent: "flex-end",
  paddingInline: 4,
});
