import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";
import type { Listening } from "@domicile-desktop/sdk/system";
import { system } from "@domicile-desktop/sdk/system";
import { watchAmbientLight } from "@domicile-desktop/system-backlight/watch-ambient-light";

/**
 * Calls `onLux` with the room's light now and after each change, and returns
 * what stops it. Never called on a machine without a sensor. Failures are
 * logged.
 */
export type AmbientLight = (onLux: (lux: number) => void) => () => void;

/** The ambient light sensor through `domicile`'s system calls. */
export const hostAmbientLight =
  (
    domicile: DomicileHost,
    watch: typeof watchAmbientLight = watchAmbientLight,
  ): AmbientLight =>
  (onLux) => {
    const started = watch(system(domicile)).then((result) =>
      result.match<Listening<number> | undefined>({
        Err: (error) => {
          logFailure(error);
          return undefined;
        },
        Ok: (found) =>
          found.match({
            None: () => undefined,
            Some: (light) => {
              readEach(light.items.getReader(), onLux).catch(logFailure);
              return light;
            },
          }),
      }),
    );
    return () => {
      started
        .then((light) => {
          light?.stop();
        })
        .catch(logFailure);
    };
  };

const readEach = async (
  reader: ReadableStreamDefaultReader<number>,
  onLux: (lux: number) => void,
): Promise<void> => {
  const read = await reader.read();
  if (!read.done) {
    onLux(read.value);
    await readEach(reader, onLux);
  }
};

const logFailure = (error: unknown): void => {
  // biome-ignore lint/suspicious/noConsole: the desk has nowhere else to say it
  console.error("could not read the ambient light sensor", error);
};
