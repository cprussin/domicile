// Audio state types shared by the client and host halves of the SDK.
//
// The compositor reads the sound server (PulseAudio or PipeWire) through
// `pactl`; see `domicile_host::audio`. Ids are opaque compositor ids taken from
// the last `audio` message.

/** A port of a device, or a profile of a card: something to switch it to. */
export type AudioChoice = {
  /** What `setAudioPort` and `setAudioProfile` name it by. */
  name: string;
  description: string;
  /**
   * `false` for a port with an empty jack, or a profile that needs one. It can
   * still be selected.
   */
  available: boolean;
};

/** An output (a sink) or an input (a source). */
export type AudioDevice = {
  id: string;
  description: string;
  /**
   * The loudest channel's volume as a fraction of 100%. Can exceed 1.
   */
  volume: number;
  muted: boolean;
  /** Whether new streams go to it. */
  default: boolean;
  /**
   * Whether it is an output's monitor source, which records what the output
   * plays. Always `false` for an output.
   */
  monitor: boolean;
  /** E.g. speakers, headphones, line in. Often empty. */
  ports: readonly AudioChoice[];
  /** The {@link AudioChoice.name} of the port in use, if it has ports. */
  port: string | undefined;
};

/** Something playing (a sink input) or recording (a source output). */
export type AudioStream = {
  id: string;
  /** The application playing or recording it. */
  application: string;
  /** The stream title, if the application set one. */
  title: string | undefined;
  volume: number;
  muted: boolean;
  /**
   * The {@link AudioDevice.id} it plays to or records from, or `undefined`
   * until the next message reports it.
   */
  device: string | undefined;
};

/** A sound card and its profiles, which select the enabled devices. */
export type AudioCard = {
  id: string;
  description: string;
  /** Sorted best first. */
  profiles: readonly AudioChoice[];
  /** The {@link AudioChoice.name} of the profile in use. */
  profile: string | undefined;
};
