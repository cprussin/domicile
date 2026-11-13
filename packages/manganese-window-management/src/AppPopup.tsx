/// <reference types="@domicile-desktop/manganese-host/domicile-elements" />

import type { WindowPopup } from "./popup";

type Props = {
  popup: WindowPopup;
};

/**
 * A client's popup (menu, tooltip, or a subsurface such as the one Firefox
 * draws its whole window into) as a bare `<app>` with no frame, placed on its
 * window's contents. `AppWindow` draws it, so it plays the window's motion.
 *
 * A press on it focuses the parent window. It shows the cursor its client
 * asks for over it.
 */
export const AppPopup = ({ popup: { appId, cursor, frame, rect } }: Props) => (
  <app
    app-id={appId}
    frame={String(frame)}
    // Inline because the box and cursor are runtime values that Panda cannot
    // extract at build time.
    style={{
      blockSize: `${rect.height.toString()}px`,
      cursor,
      inlineSize: `${rect.width.toString()}px`,
      insetBlockStart: `${rect.y.toString()}px`,
      insetInlineStart: `${rect.x.toString()}px`,
      position: "absolute",
    }}
  />
);
