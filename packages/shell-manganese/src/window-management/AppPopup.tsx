import type { PlacedPopup } from "./popup";
import { placedAt } from "./window-styles";

type Props = {
  popup: PlacedPopup;
};

/**
 * A client's popup (menu, tooltip) drawn over its window as a bare `<app>`
 * with no frame.
 *
 * A press on it focuses the parent window; see the SDK's
 * `DomicileClient.windowOf`. It is a sibling of the window because `<app>` has
 * no children, so it does not follow the window's motion. That is fine because
 * a menu is open only while its window is at rest.
 */
export const AppPopup = ({ popup: { appId, depth, rect } }: Props) => (
  <app app-id={appId} style={placedAt(rect, depth)} />
);
