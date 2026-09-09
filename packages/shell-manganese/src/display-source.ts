import type { BridgeClient } from "@domicile/chrome-sdk/bridge";
import type { DomicileDisplay } from "@domicile/chrome-sdk/domicile-host";
import type {
  Display,
  DisplaySource,
} from "@domicile/component-library/display-source";

/**
 * The desktop, as the component library wants to be told about it.
 *
 * The whole of the adapter between the control channel and the design system,
 * and the reason `DisplaySource` is a port rather than the `BridgeClient`
 * itself: `@domicile/component-library` has no protocol dependency, so the
 * shell — which has both — is where the two meet.
 *
 * It used to be the case that nothing was mapped, because `DisplayInfo` and
 * `Display` happened to be the same four fields. That comment said the
 * coincidence was not worth relying on, and it turned out not to be: the engine
 * describes a screen as `x`/`y`/`width`/`height`, because WebIDL has no tuple,
 * where `<Screen>` lays out against a `position` and a `size`. {@link asDisplay}
 * is that reshaping, and it is now what this module is for.
 *
 * Built once per bridge and not per render. `BridgeClient.on` is a single slot
 * and `DisplayProvider` re-registers whenever its source's identity changes, so
 * a source rebuilt each render would re-register each render — see
 * {@link DisplaySource}.
 */
export const displaysFrom = (bridge: BridgeClient): DisplaySource => ({
  get displays() {
    // A getter, not a snapshot: the provider reads this when it mounts and
    // again when the source changes, and the bridge may have been told a new
    // desktop in between. Copying the list at construction would hand a
    // provider mounted later the desktop as of *this* call.
    return bridge.displays?.map(asDisplay);
  },
  onDisplays: (handler) => {
    // Held, because `off` is given the handler the bridge actually registered
    // rather than the caller's: it removes one only if it is still the
    // registered one, which is what stops a teardown silencing a handler that
    // displaced it. Reshaping here is what makes the two different functions.
    const registered = ({
      displays,
    }: {
      displays: readonly DomicileDisplay[];
    }) => {
      handler(displays.map(asDisplay));
    };
    bridge.on("displays", registered);
    return () => {
      bridge.off("displays", registered);
    };
  },
});

/**
 * One screen, as a rectangle the layout can use.
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
