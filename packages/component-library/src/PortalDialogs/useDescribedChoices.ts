import type { System } from "@domicile-desktop/sdk/system";
import { useEffect, useState } from "react";

import type { DescribedChoices } from "./app-choices";
import { describeChoices } from "./app-choices";

/**
 * `choices` described, or `undefined` until first read. Reads again when the
 * choices change, keeping the last description meanwhile, and drops a read
 * the choices have moved past.
 */
export const useDescribedChoices = (
  system: System,
  choices: readonly string[],
  contentType: string | undefined,
): DescribedChoices | undefined => {
  const [described, setDescribed] = useState<DescribedChoices | undefined>();
  // The array is new on every push; its contents are what change.
  const key = choices.join("\n");

  useEffect(() => {
    let current = true;
    describeChoices(system, key === "" ? [] : key.split("\n"), contentType)
      .then((result) => {
        result.match({
          Err: (error) => {
            throw new Error(
              `could not read the applications: ${error.message}`,
            );
          },
          Ok: (found) => {
            if (current) {
              setDescribed(found);
            }
          },
        });
      })
      .catch((error: unknown) => {
        // biome-ignore lint/suspicious/noConsole: reports why the dialog lists nothing
        console.error("The app chooser could not describe its choices", error);
      });
    return () => {
      current = false;
    };
  }, [system, key, contentType]);

  return described;
};
