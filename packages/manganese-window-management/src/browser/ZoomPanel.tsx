import { AnimatedMinusIcon } from "@domicile-desktop/component-library/AnimatedMinusIcon";
import { AnimatedPlusIcon } from "@domicile-desktop/component-library/AnimatedPlusIcon";
import { Button } from "@domicile-desktop/component-library/Button";

import { css } from "../../styled-system/css";
import { hstack } from "../../styled-system/patterns";
import {
  isFullyZoomedIn,
  isFullyZoomedOut,
  isUnzoomed,
  zoomPercent,
} from "./zoom-steps";

type Props = {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  /** The page zoom factor; 1 is 100%. */
  zoom: number;
};

/**
 * A page's zoom, as Chrome's zoom bubble shows it: the level between − and +,
 * and Reset, in one row.
 */
export const ZoomPanel = ({
  onZoomIn,
  onZoomOut,
  onZoomReset,
  zoom,
}: Props) => (
  <div aria-label="Zoom" className={panelStyles} role="group">
    <span aria-hidden className={labelStyles}>
      Zoom
    </span>
    <span className={stepperStyles}>
      <Button
        disabled={isFullyZoomedOut(zoom)}
        label="Zoom out"
        onClick={onZoomOut}
        rounded
        size="sm"
        variant="ghost"
      >
        <AnimatedMinusIcon size={14} />
      </Button>
      <output className={levelStyles}>{zoomPercent(zoom)}</output>
      <Button
        disabled={isFullyZoomedIn(zoom)}
        label="Zoom in"
        onClick={onZoomIn}
        rounded
        size="sm"
        variant="ghost"
      >
        <AnimatedPlusIcon size={14} weight="bold" />
      </Button>
    </span>
    <Button
      disabled={isUnzoomed(zoom)}
      onClick={onZoomReset}
      rounded
      size="sm"
      variant="outline"
    >
      Reset
    </Button>
  </div>
);

const panelStyles = hstack({ gap: 2.5 });

const labelStyles = css({ color: "muted", fontSize: "ui" });

// One pill around − level +, so they read as one control.
const stepperStyles = hstack({
  border: "1px solid {colors.border}",
  borderRadius: "full",
  gap: 0,
  padding: 0.5,
});

// Fits the widest value, 500%, with fixed-width digits.
const levelStyles = css({
  color: "foreground",
  fontSize: "md",
  fontVariantNumeric: "tabular-nums",
  fontWeight: "semibold",
  minInlineSize: 14,
  textAlign: "center",
});
