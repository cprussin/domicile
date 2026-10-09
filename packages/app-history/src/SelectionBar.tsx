import { Button } from "@domicile-desktop/component-library/Button";
import { TrashIcon } from "@phosphor-icons/react/dist/ssr/Trash";
import { XIcon } from "@phosphor-icons/react/dist/ssr/X";
import { useState } from "react";

import { css } from "../styled-system/css";
import { hstack } from "../styled-system/patterns";

type Props = {
  count: number;
  onCancel: () => void;
  onDelete: () => void;
};

/** A bar floating over the list's foot while rows are checked. */
export const SelectionBar = ({ count, onCancel, onDelete }: Props) => {
  // The last count above zero, so the bar keeps its text while it leaves.
  const [shown, setShown] = useState(count);
  if (count > 0 && count !== shown) {
    setShown(count);
  }
  const open = count > 0;
  return (
    <div
      aria-hidden={!open}
      aria-label="Selection"
      className={barStyles}
      data-open={open ? "" : undefined}
      inert={!open}
      role="toolbar"
    >
      <span className={countStyles}>
        <span className={badgeStyles}>{shown}</span> selected
      </span>
      <span className={dividerStyles} />
      <Button
        beforeIcon={<XIcon />}
        onClick={onCancel}
        rounded
        size="sm"
        variant="ghost"
      >
        Cancel
      </Button>
      <Button
        beforeIcon={<TrashIcon />}
        onClick={onDelete}
        rounded
        size="sm"
        variant="danger"
      >
        Delete
      </Button>
    </div>
  );
};

const barStyles = hstack({
  "&[data-open]": {
    opacity: 1,
    transform: "translate(-50%, 0) scale(1)",
  },
  backdropFilter: "blur({spacing.4}) saturate(180%)",
  backgroundColor: "color-mix(in oklab, {colors.card} 94%, transparent)",
  border: "1px solid color-mix(in oklab, {colors.foreground} 14%, transparent)",
  borderRadius: "full",
  boxShadow:
    "inset 0 1px 0 color-mix(in oklab, {colors.foreground} 10%, transparent), {shadows.modal}",
  gap: 2,
  insetBlockEnd: 6,
  // Physical: the bar centers on the window, whatever the writing direction.
  left: "50%",
  opacity: 0,
  paddingBlock: 1.5,
  paddingInlineEnd: 1.5,
  paddingInlineStart: 4,
  position: "fixed",
  transform: "translate(-50%, {spacing.6}) scale(0.96)",
  transition:
    "opacity {durations.normal} {easings.out}, transform {durations.slow} {easings.outBack}",
  zIndex: 2,
});

const countStyles = hstack({
  color: "foreground",
  fontSize: "sm",
  fontWeight: "medium",
  gap: 2,
  whiteSpace: "nowrap",
});

const badgeStyles = css({
  backgroundColor: "accent",
  borderRadius: "full",
  color: "background",
  fontSize: "xs",
  fontVariantNumeric: "tabular-nums",
  fontWeight: "bold",
  minInlineSize: 6,
  paddingBlock: 0.5,
  paddingInline: 2,
  textAlign: "center",
});

const dividerStyles = css({
  backgroundColor: "border",
  blockSize: 5,
  inlineSize: "1px",
  marginInline: 1,
});
