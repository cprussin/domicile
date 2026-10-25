import type { Domicile } from "@domicile-desktop/sdk/desktop/desktop";
import type { Keymaps } from "@domicile-desktop/sdk/keymap-choice";
import type { Listening } from "@domicile-desktop/sdk/system";

/** The keymaps as the bar's keymap item uses them. */
export type HostKeymaps = {
  /**
   * Calls `onKeymaps` with the keymaps now and after each switch or reload,
   * and returns a function that stops watching.
   */
  watch: (onKeymaps: (keymaps: Keymaps) => void) => () => void;
};

/** The keymaps through `domicile`'s keyboard. Failures are logged. */
export const hostKeymaps = ({
  keyboard,
}: Pick<Domicile, "keyboard">): HostKeymaps => {
  return {
    watch: (onKeymaps) => {
      const started = keyboard.keymaps().then((result) =>
        result.match<Listening<Keymaps> | undefined>({
          Err: (error) => {
            logFailure(error);
            return undefined;
          },
          Ok: (listening) => {
            eachOf(listening.items, onKeymaps).catch(logFailure);
            return listening;
          },
        }),
      );
      return () => {
        started
          .then((listening) => {
            listening?.stop();
          })
          .catch(logFailure);
      };
    },
  };
};

const logFailure = (error: unknown): void => {
  // biome-ignore lint/suspicious/noConsole: the item keeps showing the last keymap it heard
  console.error("could not watch the keymaps", error);
};

/** Call `each` with every item `items` brings, until it closes. */
const eachOf = async <T>(
  items: ReadableStream<T>,
  each: (item: T) => void,
): Promise<void> => {
  for await (const item of items) {
    each(item);
  }
};
