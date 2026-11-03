import type { App } from "@domicile-desktop/component-library/useApps";
import { useApps } from "@domicile-desktop/component-library/useApps";
import { useSharedWatch } from "@domicile-desktop/react/use-shared-watch";
import type { Domicile } from "@domicile-desktop/sdk/desktop/desktop";

import { deskIdleHolds } from "./desk-idle-holds";
import { BROWSER } from "./wake-locked-pages";

/** What holds the desk awake, as a person knows it. */
export type NamedHolders = {
  /** Each app by name, one per hold, and {@link BROWSER} for a browser window's page. */
  readonly holders: readonly string[];
  /** Each named app's icon, by its name. */
  readonly icons: ReadonlyMap<string, string>;
};

/** What holds the desk awake, each app named by its desktop entry. */
export const useNamedHolders = (domicile: Domicile): NamedHolders => {
  const ids = useSharedWatch(deskIdleHolds(domicile)) ?? [];
  return namedHolders(
    ids,
    useApps(
      domicile,
      ids.filter((id) => id !== BROWSER),
    ),
  );
};

/** `ids`, each app as `app` names it, with its icon. */
export const namedHolders = (
  ids: readonly string[],
  app: (appId: string) => App,
): NamedHolders => ({
  holders: ids.map((id) => (id === BROWSER ? id : app(id).name)),
  icons: new Map(
    ids
      .filter((id) => id !== BROWSER)
      .map((id) => app(id))
      .flatMap(({ icon, name }) =>
        icon === undefined ? [] : [[name, icon] as const],
      ),
  ),
});
