import type {
  Display,
  DisplaySource,
} from "@domicile-desktop/component-library/display-source";
import type {
  DomicileDisplay,
  DomicileHost,
} from "@domicile-desktop/sdk/domicile-host";

import { watchHost } from "../host/watch-host";

/**
 * Adapts the host's desktop description to the component library's
 * `DisplaySource`.
 *
 * The library has no protocol dependency, so the shell, which has both, does
 * the adapting.
 *
 * Build once per host, not per render: `DisplayProvider` re-registers
 * whenever the source's identity changes.
 */
export const hostDisplays = (domicile: DomicileHost): DisplaySource => ({
  get displays() {
    // A getter, not a snapshot: the provider reads this on mount and on source
    // change, and the desktop may have changed since construction.
    return displaysOf(domicile);
  },
  onDisplays: (handler) =>
    watchHost(domicile, "displayschanged", displaysOf, handler),
});

/**
 * One screen as a rectangle for layout. The engine uses `x`/`y`/`width`/
 * `height` (WebIDL has no tuples); `<Screen>` uses `position` and `size`.
 *
 * Both are logical CSS pixels in one desktop-wide space with its origin at the
 * displays' bounding box, so values are regrouped, not converted.
 *
 * `scale` is the scale clients on that screen draw at, not this page's: the
 * shell is one page at one `devicePixelRatio`.
 */
const asDisplay = (display: DomicileDisplay): Display => ({
  name: display.name,
  position: [display.x, display.y],
  scale: display.scale,
  size: [display.width, display.height],
});

/** The host's displays, or `undefined` before it has described any. */
const displaysOf = ({
  displays,
}: DomicileHost): readonly Display[] | undefined =>
  displays === null ? undefined : displays.map(asDisplay);
