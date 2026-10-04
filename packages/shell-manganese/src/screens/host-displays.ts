import type {
  Display,
  DisplaySource,
} from "@domicile-desktop/component-library/display-source";
import type { DomicileClient } from "@domicile-desktop/sdk/domicile-client";
import type { DomicileDisplay } from "@domicile-desktop/sdk/domicile-host";

/**
 * Adapts the host's desktop description to the component library's
 * `DisplaySource`.
 *
 * The library has no protocol dependency, so the shell, which has both, does
 * the adapting.
 *
 * Build once per client, not per render: `DomicileClient.on` is a single slot
 * and `DisplayProvider` re-registers whenever the source's identity changes.
 */
export const hostDisplays = (domicile: DomicileClient): DisplaySource => ({
  get displays() {
    // A getter, not a snapshot: the provider reads this on mount and on source
    // change, and the desktop may have changed since construction.
    return domicile.displays?.map(asDisplay);
  },
  onDisplays: (handler) => {
    // Keep the wrapped handler, because `off` only removes the handler if it is
    // still the registered one. That stops a teardown from silencing a handler
    // that replaced it.
    const registered = ({
      displays,
    }: {
      displays: readonly DomicileDisplay[];
    }) => {
      handler(displays.map(asDisplay));
    };
    domicile.on("displays", registered);
    return () => {
      domicile.off("displays", registered);
    };
  },
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
