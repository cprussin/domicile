import { CaretDownIcon } from "@phosphor-icons/react/dist/ssr/CaretDown";
import type { ReactNode } from "react";

import { css } from "../../styled-system/css";
import { flex } from "../../styled-system/patterns";

type Props = {
  /** What the contents are, such as "Docs menu". */
  label: string;
  /** What is showing now, beside the label, such as the page being read. */
  detail: string;
  children: ReactNode;
};

/**
 * A slim row that folds its contents away, for navigation on a narrow screen.
 * A native `<details>`, so touch, Enter and Space toggle it and its expanded
 * state is announced without a script.
 */
export const Disclosure = ({ label, detail, children }: Props) => (
  <details className={detailsStyles}>
    <summary className={summaryStyles}>
      <span className={labelStyles}>{label}</span>
      <span className={detailStyles}>{detail}</span>
      <CaretDownIcon aria-hidden className={caretStyles} />
    </summary>
    <div className={contentStyles}>{children}</div>
  </details>
);

const detailsStyles = css({
  backgroundColor: "card",
  border: "1px solid {colors.border}",
  borderRadius: "xl",
  fontSize: "sm",
});

const summaryStyles = flex({
  _focusVisible: { outline: "2px solid {colors.accent}", outlineOffset: "2px" },
  "&::-webkit-details-marker": { display: "none" },
  align: "baseline",
  borderRadius: "xl",
  cursor: "pointer",
  gap: 2,
  listStyle: "none",
  paddingBlock: 2.5,
  paddingInline: 4,
});

const labelStyles = css({ flexShrink: 0, fontWeight: "semibold" });

const detailStyles = css({
  color: "muted",
  flex: 1,
  minInlineSize: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

const caretStyles = css({
  alignSelf: "center",
  color: "muted",
  "details[open] > summary > &": { transform: "rotate(180deg)" },
  flexShrink: 0,
  transition: "transform {durations.fast} {easings.out}",
});

const contentStyles = css({
  borderBlockStart: "1px solid {colors.border}",
  paddingBlock: 4,
  paddingInline: 4,
});
