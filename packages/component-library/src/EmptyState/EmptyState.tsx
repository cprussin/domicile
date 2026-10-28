import type { Icon } from "@phosphor-icons/react";

import { css } from "../../styled-system/css";
import { center, flex } from "../../styled-system/patterns";

type Props = {
  /** What is missing, such as Wi-Fi's slashed fan for Wi-Fi turned off. */
  icon: Icon;
  /** What is missing, in plain words: `Wi-Fi is off`. */
  title: string;
  /** What would fill it, in a short sentence. */
  hint?: string | undefined;
};

/**
 * A panel or section with nothing to show: an icon in a soft circle, what is
 * missing, and what would fill it. Centered in the room the panel has.
 * Announced as it changes.
 */
export const EmptyState = ({ hint, icon: Icon, title }: Props) => (
  <div className={rootStyles} role="status">
    <span className={discStyles}>
      <Icon aria-hidden size={20} weight="bold" />
    </span>
    <span className={titleStyles}>{title}</span>
    {hint !== undefined && <span className={hintStyles}>{hint}</span>}
  </div>
);

const rootStyles = flex({
  align: "center",
  direction: "column",
  flex: 1,
  gap: 1.5,
  justify: "center",
  paddingBlock: 5,
  paddingInline: 3,
  textAlign: "center",
});

const discStyles = center({
  backgroundColor: "fill",
  blockSize: 10,
  borderRadius: "full",
  color: "textSoft",
  inlineSize: 10,
  marginBlockEnd: 1,
});

const titleStyles = css({ textStyle: "panelLabel" });

// Narrower than a panel, so a hint wraps to two even lines.
const hintStyles = css({
  color: "textSoft",
  maxInlineSize: "15rem",
  textStyle: "panelDetail",
});
