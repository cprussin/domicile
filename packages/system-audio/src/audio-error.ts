export enum AudioErrorKind {
  /** A volume that is NaN or infinite. */
  NotANumber,
  /** An id that must name a device and names a stream. */
  NotADevice,
  /** A stream moved to a device of the other direction. */
  Mismatched,
  /** An id `watchAudio` never reported. */
  UnknownId,
  /** `pactl` could not run, or the sound server refused. */
  Refused,
}

/** Why the sound server was not asked, or said no. */
export const AudioError = {
  Mismatched: (stream: string, device: string) => ({
    device,
    kind: AudioErrorKind.Mismatched as const,
    stream,
  }),
  NotADevice: (id: string) => ({
    id,
    kind: AudioErrorKind.NotADevice as const,
  }),
  NotANumber: () => ({ kind: AudioErrorKind.NotANumber as const }),
  /** `message` is `pactl`'s error output, or why it did not run. */
  Refused: (message: string) => ({
    kind: AudioErrorKind.Refused as const,
    message,
  }),
  UnknownId: (id: string) => ({ id, kind: AudioErrorKind.UnknownId as const }),
};

export type AudioError = ReturnType<
  (typeof AudioError)[keyof typeof AudioError]
>;
