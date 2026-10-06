import type { Result } from "@cprussin/option-result";
import type { Asked } from "@domicile-desktop/system-audio/asked";
import type { AudioError } from "@domicile-desktop/system-audio/audio-error";

/**
 * Sends a mixer request without waiting. The mixer follows the server's
 * state, so a refusal shows as the control not moving; it is logged.
 */
export const ask = (asking: Promise<Result<Asked, AudioError>>): void => {
  asking.then(
    (asked) => {
      asked.match({
        Err: (error) => {
          // biome-ignore lint/suspicious/noConsole: nothing in the mixer shows a refusal
          console.error("the sound server refused the mixer", error);
        },
        Ok: () => undefined,
      });
    },
    (error: unknown) => {
      // biome-ignore lint/suspicious/noConsole: nothing in the mixer shows a failure
      console.error("the mixer could not ask the sound server", error);
    },
  );
};
