import type { ReactNode } from "react";
import { useId } from "react";

import { css } from "../../styled-system/css";
import { flex, hstack } from "../../styled-system/patterns";
import "../stylesheet";

type Props = {
  /** Controls beside the label, such as a switch. */
  action?: ReactNode | undefined;
  children: ReactNode;
  /** Names the section, in small capitals over it. */
  label: string;
};

/**
 * A group in a panel, under a small label: a drawer's inboxes, a mixer's
 * outputs, Bluetooth's paired devices. Sections sit a step apart in a
 * column, so the labels do the grouping without rules between them.
 */
export const PanelSection = ({ action, children, label }: Props) => {
  const id = useId();
  return (
    <section aria-labelledby={id} className={sectionStyles}>
      <div className={headStyles}>
        <h3 className={labelStyles} id={id}>
          {label}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
};

const sectionStyles = flex({ direction: "column", gap: 1, minInlineSize: 0 });

// As tall as a switch, so a section with one lines up with one without.
const headStyles = hstack({
  gap: 2,
  justify: "space-between",
  minBlockSize: 5,
});

const labelStyles = css({
  color: "textFaint",
  margin: 0,
  textStyle: "panelOverline",
});
