import type { Result } from "@cprussin/option-result";
import type {
  MenuEntry,
  WatchedMenu,
  watchMenu,
} from "@domicile-desktop/sdk/dbusmenu";
import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";
import type { SystemError } from "@domicile-desktop/sdk/system";
import { system } from "@domicile-desktop/sdk/system";
import { useEffect, useState } from "react";

/** An open tray menu: what it holds, and the requests it takes. */
export type OpenTrayMenu = {
  menu: Result<readonly MenuEntry[], SystemError>;
  click: (id: number) => void;
  /** Call before showing the submenu under `id`. */
  aboutToShow: (id: number) => void;
};

/**
 * The `com.canonical.dbusmenu` menu at `path` on `bus`, watched while `open`.
 * `undefined` while closed and until the first read.
 *
 * Opening tells the application, with `AboutToShow`, so it can fill the menu
 * first. A refused request is logged.
 */
export const useTrayMenu = (
  domicile: DomicileHost,
  bus: string,
  path: string,
  open: boolean,
  watch: typeof watchMenu,
): OpenTrayMenu | undefined => {
  const [menu, setMenu] = useState<
    Result<readonly MenuEntry[], SystemError> | undefined
  >(undefined);
  const [requests, setRequests] = useState<WatchedMenu | undefined>(undefined);

  useEffect(() => {
    if (open) {
      const watched = watch(system(domicile), { bus, path }, setMenu);
      setRequests(watched);
      sent(watched.aboutToShow(0));
      return () => {
        watched.stop();
        setMenu(undefined);
        setRequests(undefined);
      };
    } else {
      return undefined;
    }
  }, [bus, domicile, open, path, watch]);

  return menu === undefined || requests === undefined
    ? undefined
    : {
        aboutToShow: (id) => {
          sent(requests.aboutToShow(id));
        },
        click: (id) => {
          sent(requests.click(id));
        },
        menu,
      };
};

/** Logs `request`'s failure: the menu has nothing to show for one. */
const sent = (request: Promise<Result<string, SystemError>>): void => {
  request.then(
    (result) => {
      result.match({
        Err: (error) => {
          // biome-ignore lint/suspicious/noConsole: surfacing a refused request
          console.error("A tray menu refused a request", error);
        },
        Ok: () => {
          /* done */
        },
      });
    },
    (error: unknown) => {
      // biome-ignore lint/suspicious/noConsole: surfacing a background failure
      console.error("Failed to send a tray menu request", error);
    },
  );
};
