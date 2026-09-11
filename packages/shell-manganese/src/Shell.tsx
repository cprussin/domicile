import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import { DisplayProvider } from "@domicile/component-library/DisplayProvider";
import type { DisplaySource } from "@domicile/component-library/display-source";
import { Provider } from "@domicile/component-library/Provider";

import { Desktop } from "./Desktop";

type Props = {
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
};

/**
 * The reference chrome over the desktop the host described.
 *
 * The page spans every display, so this is the composition root in the literal
 * sense as well: it holds the one {@link DisplayProvider} the whole tree reads
 * its screens from. `on` is a single slot, so there is exactly one listener for
 * the host's descriptions and every `<Screen>` below fans out from it.
 */
export const Shell = ({ domicile, displays }: Props) => (
  <Provider>
    <DisplayProvider source={displays}>
      <Desktop domicile={domicile} />
    </DisplayProvider>
  </Provider>
);
