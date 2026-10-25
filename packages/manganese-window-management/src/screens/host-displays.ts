import type {
  Display,
  DisplaySource,
} from "@domicile-desktop/component-library/display-source";
import { watchHost } from "@domicile-desktop/manganese-host/watch-host";
import type { Domicile } from "@domicile-desktop/sdk/desktop/desktop";
import type { Display as DomicileDisplay } from "@domicile-desktop/sdk/desktop/displays";

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
export const hostDisplays = ({
  displays,
}: Pick<Domicile, "displays">): DisplaySource => ({
  get displays() {
    // A getter, not a snapshot: the provider reads this on mount and on source
    // change, and the desktop may have changed since construction.
    return displays.list?.map(asDisplay);
  },
  onDisplays: (handler) =>
    watchHost(
      (changed) => displays.on("change", changed),
      () => displays.list?.map(asDisplay),
      handler,
    ),
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
