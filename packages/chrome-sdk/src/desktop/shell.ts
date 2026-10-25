// What the desk says to the shell itself: its options from the config, and
// commands from `domicile send-shell`.

import { z } from "zod";

import type { DomicileHost } from "../domicile-host";
import { memoizeLast } from "./memoize-last";
import type { On } from "./subscribe";
import { hostEvent, on } from "./subscribe";
import type { System } from "./system-calls";

export type ShellListeners = {
  optionschange: () => void;
};

export type ShellNamespace = {
  /**
   * The config's `shell_options`, unchecked: `undefined` until the compositor
   * says. Check them against the shell's declaration with `watchShellOptions`.
   */
  readonly options: Readonly<Record<string, unknown>> | undefined;
  /** Hear each command `domicile send-shell` sends, as its words. */
  commands: System["shellCommands"];
  on: On<ShellListeners>;
};

export type ShellHost = Pick<
  DomicileHost,
  "addEventListener" | "removeEventListener" | "shellOptions"
>;

export const shell = (
  host: ShellHost,
  calls: Pick<System, "shellCommands">,
): ShellNamespace => {
  const optionsOf = memoizeLast((text: string | null) =>
    text === null ? undefined : optionsSchema.parse(JSON.parse(text)),
  );
  return {
    commands: () => calls.shellCommands(),
    on: on<ShellListeners>({
      optionschange: (listener) =>
        hostEvent(host, "shelloptionschanged", () => listener()),
    }),
    get options() {
      return optionsOf(host.shellOptions);
    },
  };
};

const optionsSchema = z.record(z.string(), z.unknown());
