/// <reference types="@domicile-desktop/manganese-host/domicile-elements" />

import type { PlacedPopup } from "./popup";
import { placedAt } from "./window-styles";

type Props = {
  popup: PlacedPopup;
};

/**
 * A client's popup (menu, tooltip) drawn over its window as a bare `<app>`
 * with no frame.
 *
 * A press on it focuses the parent window. It is a sibling of the window
 * because `<app>` has no children, so it does not follow the window's motion.
 * That is fine because a menu is open only while its window is at rest.
 *
 * It shows the cursor its client asks for over it. Firefox draws its whole
 * window into one, so that is every cursor Firefox asks for.
 */
export const AppPopup = ({
  popup: { appId, cursor, depth, frame, rect },
}: Props) => (
  <app
    app-id={appId}
    frame={String(frame)}
    style={{ ...placedAt(rect, depth), cursor }}
  />
);
