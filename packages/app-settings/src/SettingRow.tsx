import type { ReactNode } from "react";

import { css } from "../styled-system/css";
import { flex } from "../styled-system/patterns";

type Props = {
  /** The control, which names itself with the same `title`. */
  children: ReactNode;
  hint?: ReactNode | undefined;
  title: string;
};

/** One setting: its name and hint beside its control. */
export const SettingRow = ({ children, hint, title }: Props) => (
  <div className={rowStyles}>
    <div className={textStyles}>
      <span className={titleStyles}>{title}</span>
      {hint !== undefined && <span className={hintStyles}>{hint}</span>}
    </div>
    <div className={controlStyles}>{children}</div>
  </div>
);

const rowStyles = flex({
  "&:first-of-type": { borderBlockStart: "none", paddingBlockStart: 0 },
  "&:last-of-type": { paddingBlockEnd: 0 },
  alignItems: "center",
  borderBlockStart: "1px solid {colors.border}",
  gap: 6,
  justify: "space-between",
  paddingBlock: 3.5,
  wrap: "wrap",
});

const textStyles = flex({
  direction: "column",
  flex: "1 1 {spacing.56}",
  gap: 0.5,
  minInlineSize: 0,
});

const titleStyles = css({
  color: "foreground",
  fontSize: "sm",
  fontWeight: "medium",
});

const hintStyles = css({
  color: "muted",
  fontSize: "xs",
  lineHeight: "normal",
});

const controlStyles = flex({
  alignItems: "center",
  flex: "0 1 auto",
  gap: 2,
  justify: "flex-end",
  minInlineSize: 0,
});
