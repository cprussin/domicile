import { useScreenRegion } from "@domicile-desktop/component-library/DisplayProvider";
import type { ReactNode } from "react";
import { css } from "../styled-system/css";

/** A toast centered near the bottom of `screen`. */
export const ScreenNotice = ({
  children,
  screen,
}: {
  children: ReactNode;
  screen: string;
}) => {
  const region = useScreenRegion(screen);
  return (
    <div className={screenStyles} style={region}>
      {children}
    </div>
  );
};

// The screen's box, over windows and under panels like the toasts. Ignores the
// pointer so windows under it stay clickable. The toast sits centered near
// its bottom edge.
const screenStyles = css({
  alignItems: "flex-end",
  display: "flex",
  justifyContent: "center",
  paddingBlockEnd: 20,
  pointerEvents: "none",
  position: "fixed",
  zIndex: "toast",
});
