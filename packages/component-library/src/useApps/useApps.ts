import type { System } from "@domicile-desktop/sdk/system";
import type { DescribedApp } from "@domicile-desktop/system-apps/describe-apps";
import { describeApps } from "@domicile-desktop/system-apps/describe-apps";
import { useCallback, useEffect, useState } from "react";

/** An application as a dialog or indicator shows it. */
export type App = {
  name: string;
  /** A `data:` URL, or `undefined` for none. */
  icon: string | undefined;
};

/**
 * Names each application by its desktop entry, with its icon, reading the
 * entries for `ids` again when they change. An id with no entry, or not read
 * yet, is named by itself; the empty id is "An application".
 */
export const useApps = (
  system: System,
  ids: readonly string[],
): ((appId: string) => App) => {
  const [described, setDescribed] = useState<ReadonlyMap<string, DescribedApp>>(
    new Map(),
  );
  // The array is new on every push; its contents are what change.
  const key = [...new Set(ids.filter((id) => id !== ""))].toSorted().join("\n");

  useEffect(() => {
    if (key === "") {
      return undefined;
    } else {
      let current = true;
      describeApps(system, key.split("\n"))
        .then((result) => {
          result.match({
            Err: (error) => {
              throw new Error(
                `could not read the applications: ${error.message}`,
              );
            },
            Ok: (found) => {
              if (current) {
                setDescribed(new Map(found.map((app) => [app.id, app])));
              }
            },
          });
        })
        .catch((error: unknown) => {
          // biome-ignore lint/suspicious/noConsole: applications stay named by their ids; say why
          console.error("Could not name the applications", error);
        });
      return () => {
        current = false;
      };
    }
  }, [system, key]);

  return useCallback((appId) => app(described, appId), [described]);
};

/** `appId` as `described` names it. */
const app = (
  described: ReadonlyMap<string, DescribedApp>,
  appId: string,
): App => {
  const entry = described.get(appId);
  if (entry === undefined) {
    return { icon: undefined, name: appId === "" ? "An application" : appId };
  } else {
    return { icon: entry.icon, name: entry.name };
  }
};
