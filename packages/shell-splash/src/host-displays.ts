// The host's displays as the component library's `DisplaySource`, so the
// splash can draw itself once per display. Manganese adapts them the same way
// in its own `screens/host-displays.ts`.

import type {
  Display,
  DisplaySource,
} from "@domicile-desktop/component-library/display-source";
import type {
  DomicileDisplay,
  DomicileHost,
} from "@domicile-desktop/sdk/domicile-host";

/** Build once per host: `DisplayProvider` re-registers on a new source. */
export const hostDisplays = (domicile: DomicileHost): DisplaySource => ({
  get displays() {
    return displaysOf(domicile);
  },
  onDisplays: (handler) => {
    const changed = () => {
      const displays = displaysOf(domicile);
      if (displays !== undefined) {
        handler(displays);
      }
    };
    domicile.addEventListener("displayschanged", changed);
    return () => {
      domicile.removeEventListener("displayschanged", changed);
    };
  },
});

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
