import { Button } from "@domicile-desktop/component-library/Button";
import { BrowsersIcon } from "@phosphor-icons/react/dist/ssr/Browsers";
import { CornersInIcon } from "@phosphor-icons/react/dist/ssr/CornersIn";
import { CornersOutIcon } from "@phosphor-icons/react/dist/ssr/CornersOut";
import { SquaresFourIcon } from "@phosphor-icons/react/dist/ssr/SquaresFour";

import { css } from "../../styled-system/css";
import { hstack } from "../../styled-system/patterns";
import type { Rect } from "./rect";
import { placedAt } from "./window-styles";

type Props = {
  /** The stacking depth of the strip's last tab. */
  depth: number;
  /** Whether the group floats. Switches the float button to "Tile". */
  floating: boolean;
  /** Whether the group fills the screen. Switches the button to "Restore". */
  fullscreen: boolean;
  /** Floats or tiles the whole group. */
  onFloat: () => void;
  /** Fills the screen with the whole group, or gives it back. */
  onFullscreen: () => void;
  /** The strip's empty end. See `stripEndOf`. */
  rect: Rect;
};

/**
 * The buttons at the far end of a tabbed strip, which float and fullscreen its
 * whole group.
 *
 * Drawn after the strip's tabs at their depth, since the last tab paints the
 * strip past itself. Only the buttons take the pointer, so the new-tab button
 * and the end's drag handle (`StripEnd`) beside them still get theirs.
 */
export const StripButtons = ({
  depth,
  floating,
  fullscreen,
  onFloat,
  onFullscreen,
  rect,
}: Props) => (
  <div className={endStyles} style={placedAt(rect, depth)}>
    <span className={controlStyles}>
      <Button
        label={floating ? "Tile group" : "Float group"}
        onClick={onFloat}
        size="xs"
        variant="ghost"
      >
        {floating ? <SquaresFourIcon size={12} /> : <BrowsersIcon size={12} />}
      </Button>
      <Button
        label={fullscreen ? "Restore group" : "Maximize group"}
        onClick={onFullscreen}
        size="xs"
        variant="ghost"
      >
        {fullscreen ? (
          <CornersInIcon size={12} />
        ) : (
          <CornersOutIcon size={12} />
        )}
      </Button>
    </span>
  </div>
);

const endStyles = css({ pointerEvents: "none", position: "absolute" });

/**
 * At the strip's far end, level with the new-tab button at its start (see
 * `newTabStyles` in `TitleBar`).
 */
const controlStyles = hstack({
  gap: 0,
  insetBlockEnd: "1px",
  insetBlockStart: 1,
  insetInlineEnd: 1,
  pointerEvents: "auto",
  position: "absolute",
});
