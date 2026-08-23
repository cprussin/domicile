import type { BridgeClient } from "@domicile/chrome-sdk/bridge";
import type {
  Display,
  DisplaySource,
} from "@domicile/component-library/display-source";

/**
 * The desktop, as the component library wants to be told about it.
 *
 * The whole of the adapter between the wire and the design system, and the
 * reason `DisplaySource` is a port rather than the `BridgeClient` itself:
 * `@domicile/component-library` has no protocol dependency, so the shell —
 * which has both — is where the two meet.
 *
 * `DisplayInfo` and `Display` are the same four fields, so nothing is mapped.
 * That is not a coincidence worth relying on: if the wire grows a field the
 * layout does not need, this function is where it stops.
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
    return bridge.displays;
  },
  onDisplays: (handler) => {
    // Held, because `off` is given the handler the bridge actually registered
    // rather than the caller's: it removes one only if it is still the
    // registered one, which is what stops a teardown silencing a handler that
    // displaced it. Unwrapping `{ displays }` here is what makes the two
    // different functions.
    const registered = ({ displays }: { displays: readonly Display[] }) => {
      handler(displays);
    };
    bridge.on("displays", registered);
    return () => {
      bridge.off("displays", registered);
    };
  },
});
