import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import { DisplayProvider } from "@domicile/component-library/DisplayProvider";
import type { DisplaySource } from "@domicile/component-library/display-source";
import { Provider } from "@domicile/component-library/Provider";
import type { ThemeSource } from "@domicile/component-library/theme-source";

import { Desktop } from "./Desktop";
import type { DeskChannel } from "./window-management/desk-channel";

type Props = {
  /**
   * The other pages of this desk.
   *
   * Passed in for `displays`'s reason: it is a connection, and a desk of
   * several monitors is several pages of this shell with one desktop between
   * them — `window-management/desk-channel.ts` says how.
   */
  desk: DeskChannel;
  /**
   * Where the desktop comes from — the host over the control channel, or the
   * window itself where there is no host. Passed in rather than built here
   * because the entry point is what knows which of those this is, and because a
   * source is the connection: the provider re-registers whenever its identity
   * changes and `DomicileClient.on` is a single slot, so one built per render
   * would re-register per render.
   */
  displays: DisplaySource;
  domicile: DomicileClient;
  /**
   * Where the theme comes from, and what the bar's toggle asks. The host over
   * the control channel, or the page itself where there is no host — passed in
   * for {@link displays}'s reason, and for one more: the theme is the
   * desktop's, so a shell that built its own would be the one monitor that
   * changed.
   */
  theme: ThemeSource;
};

/**
 * The reference chrome over the desktop the host described.
 *
 * The page spans every display, so this is the composition root in the literal
 * sense as well: it holds the one {@link DisplayProvider} the whole tree reads
 * its screens from. `on` is a single slot, so there is exactly one listener for
 * the host's descriptions and every `<Screen>` below fans out from it.
 */
export const Shell = ({ desk, displays, domicile, theme }: Props) => (
  <Provider theme={theme}>
    <DisplayProvider source={displays}>
      <Desktop desk={desk} domicile={domicile} />
    </DisplayProvider>
  </Provider>
);
