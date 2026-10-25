// The host's displays as the component library's `DisplaySource`, so the
// splash can draw itself once per display. Manganese adapts them the same way
// in its own `screens/host-displays.ts`.

import type {
  Display,
  DisplaySource,
} from "@domicile-desktop/component-library/display-source";
import type { Domicile } from "@domicile-desktop/sdk/desktop/desktop";
import type { Display as DomicileDisplay } from "@domicile-desktop/sdk/desktop/displays";

/** Build once per host: `DisplayProvider` re-registers on a new source. */
export const hostDisplays = ({
  displays,
}: Pick<Domicile, "displays">): DisplaySource => ({
  get displays() {
    return displays.list?.map(asDisplay);
  },
  onDisplays: (handler) =>
    displays.on("change", () => {
      const list = displays.list;
      if (list !== undefined) {
        handler(list.map(asDisplay));
      }
    }),
});

const asDisplay = (display: DomicileDisplay): Display => ({
  name: display.name,
  position: [display.x, display.y],
  scale: display.scale,
  size: [display.width, display.height],
});
