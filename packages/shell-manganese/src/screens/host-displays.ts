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
 * The desktop the host describes, as the component library wants to be told
 * about it.
 *
 * The whole of the adapter between the desktop and the design system,
 * and the reason `DisplaySource` is a port rather than the host itself:
 * `@domicile-desktop/component-library` has no protocol dependency, so the
 * shell — which has both — is where the two meet.
 */
export const hostDisplays = (domicile: DomicileHost): DisplaySource => ({
  get displays() {
    // A getter, not a snapshot: the provider reads this when it mounts and
    // again when the source changes, and the host may have been told a new
    // desktop in between.
    return displaysOf(domicile);
  },
  onDisplays: (handler) =>
    watchHost(domicile, "displayschanged", displaysOf, handler),
});

/**
 * One screen, as a rectangle the layout can use. The engine describes a screen
 * as `x`/`y`/`width`/`height`, because WebIDL has no tuple, where `<Screen>`
 * lays out against a `position` and a `size`.
 *
 * Both shapes are logical CSS pixels in one desktop-wide space whose origin is
 * the top-left of the displays' bounding box, so `position` is directly where a
 * `<Screen>` goes on the page and nothing is converted — only regrouped.
 *
 * `scale` is carried across unchanged and is the one field that means something
 * other than what a reader might assume: it is what *clients* on that screen
 * draw at, not what this page renders at. The shell is one page at one
 * `devicePixelRatio` however many screens it spans.
 */
const asDisplay = (display: DomicileDisplay): Display => ({
  name: display.name,
  position: [display.x, display.y],
  scale: display.scale,
  size: [display.width, display.height],
});

/** The desktop the host holds, or `undefined` before it has described one. */
const displaysOf = ({
  displays,
}: DomicileHost): readonly Display[] | undefined =>
  displays === null ? undefined : displays.map(asDisplay);
