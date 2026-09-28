import type { PlacedPopup } from "./popup";
import { placedAt } from "./window-styles";

type Props = {
  popup: PlacedPopup;
};

/**
 * A client's popup — a menu, a tooltip — over its window.
 *
 * An `<app>` like the window's, because it is a surface of the client's own,
 * with none of a window's frame: no bar, no edge, no motion, and nothing to
 * grab. The SDK forwards the pointer over it to the popup, and a press on it
 * asks for its window's keyboard rather than its own — see the SDK's
 * `DomicileClient.windowOf`.
 *
 * Placed against the window's box rather than inside its element, because an
 * `<app>` is a replaced element and has no children. That is also why a
 * window's motion — its scale on arrival, its shuffle when raised — does not
 * carry a popup with it: a menu is open while the window is at rest.
 */
export const AppPopup = ({ popup: { appId, depth, rect } }: Props) => (
  <app app-id={appId} style={placedAt(rect, depth)} />
);
