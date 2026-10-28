import type { ReactNode } from "react";

import { hstack } from "../../styled-system/patterns";

type Props = {
  /** A button at the end, such as one to clear the list. */
  action?: ReactNode | undefined;
  /** A short summary, such as the battery or a count. */
  children?: ReactNode | undefined;
};

/** A panel's last line, under a rule: quieter than the controls above it. */
export const PanelFooter = ({ action, children }: Props) => (
  <footer className={footerStyles}>
    <span>{children}</span>
    {action}
  </footer>
);

// The action's own padding hangs past the panel's edge, so its label lines
// up with the controls above. The gap under the rule matches the panel's
// padding below, so the line sits centered between the rule and the edge.
const footerStyles = hstack({
  "& > button:last-child": { marginInlineEnd: -1.5 },
  borderBlockStart: "1px solid {colors.divider}",
  color: "textSoft",
  gap: 2,
  justify: "space-between",
  minBlockSize: 7,
  paddingBlockStart: 3,
  textStyle: "panelDetail",
});
