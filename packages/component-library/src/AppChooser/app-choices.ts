// The applications an app chooser offers, described from their desktop
// entries, and which to pick first.

import type { Result } from "@cprussin/option-result";
import { Ok } from "@cprussin/option-result";
import type { System, SystemError } from "@domicile-desktop/sdk/system";
import type { DescribedApp } from "@domicile-desktop/system-apps/describe-apps";
import { describeApps } from "@domicile-desktop/system-apps/describe-apps";
import { defaultApps } from "@domicile-desktop/system-apps/mime-apps";

/** The offered applications, described, and the defaults for the type. */
export type DescribedChoices = {
  apps: DescribedApp[];
  /** `mimeapps.list`'s defaults, desktop file IDs without `.desktop`. */
  defaults: string[];
};

/**
 * Describe `choices`, in their order, and read `contentType`'s defaults: none
 * when it is `undefined`.
 */
export const describeChoices = async (
  system: System,
  choices: readonly string[],
  contentType: string | undefined,
): Promise<Result<DescribedChoices, SystemError>> => {
  const [apps, defaults] = await Promise.all([
    describeApps(system, choices),
    contentType === undefined
      ? Ok<string[], SystemError>([])
      : defaultApps(system, contentType),
  ]);
  return apps.andThen((found) =>
    defaults.map((ids) => ({
      apps: found,
      defaults: ids.map(withoutSuffix),
    })),
  );
};

/**
 * The application to pick first: the last one chosen, else the first default
 * offered, else the first offered.
 */
export const preselected = (
  choices: readonly string[],
  lastChoice: string | undefined,
  defaults: readonly string[],
): string | undefined =>
  [lastChoice, ...defaults, choices[0]].find(
    (id) => id !== undefined && choices.includes(id),
  );

const withoutSuffix = (id: string): string => id.replace(/\.desktop$/, "");
