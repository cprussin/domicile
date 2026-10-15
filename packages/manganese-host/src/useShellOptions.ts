import type {
  Options,
  OptionValues,
  ShellOptionsHost,
} from "@domicile-desktop/sdk/options";
import { readOptions, watchShellOptions } from "@domicile-desktop/sdk/options";
import { useEffect, useState } from "react";

/**
 * The values the config gives the options `declared`, following it as it
 * changes; the defaults until the host is first read. A value `declared`
 * refuses takes its default and is reported to the console. See
 * `docs/WRITING-A-SHELL.md#options`.
 *
 * `declared` should be a constant: a new one reads the options again.
 */
export const useShellOptions = <T extends Options>(
  host: ShellOptionsHost,
  declared: T,
): OptionValues<T> => {
  const [values, setValues] = useState<OptionValues<T> | undefined>(undefined);

  useEffect(
    () => watchShellOptions(host, declared, setValues),
    [host, declared],
  );

  return values ?? readOptions(declared, undefined).values;
};
