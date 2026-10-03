// The desk's sound, as a shell's mixer draws it and asks of it.
//
// Its own module for `tray.ts`'s reason: both halves of the SDK need these
// shapes, and only one of them is the wire. The compositor reads the sound
// server with `pactl` — PulseAudio's or PipeWire's — see `domicile_host::audio`.
//
// Every id is the compositor's, opaque here: what a request names a device or
// a stream by, taken from the last `audio` message.

/** A port of a device, or a profile of a card: something to switch it to. */
export type AudioChoice = {
  /** What `setAudioPort` and `setAudioProfile` name it by. */
  name: string;
  description: string;
  /**
   * `false` for a port whose jack is empty, or a profile that needs one.
   * Still choosable, as every mixer lets it be.
   */
  available: boolean;
};

/** An output (a sink) or an input (a source). */
export type AudioDevice = {
  id: string;
  description: string;
  /**
   * The loudest of its channels, as a fraction of the server's 100% — more
   * than 1 for one turned up past it.
   */
  volume: number;
  muted: boolean;
  /** Whether new streams go to it. */
  default: boolean;
  /**
   * Whether it is an output's monitor — what the output plays, as something
   * to record. Always `false` for an output.
   */
  monitor: boolean;
  /** Speakers, headphones, a line in. Often empty. */
  ports: readonly AudioChoice[];
  /** The {@link AudioChoice.name} of the port in use, if it has ports. */
  port: string | undefined;
};

/** Something playing (a sink input) or recording (a source output). */
export type AudioStream = {
  id: string;
  /** Who is playing or recording it. */
  application: string;
  /** What it is — a song, a call — where the application said. */
  title: string | undefined;
  volume: number;
  muted: boolean;
  /**
   * The {@link AudioDevice.id} it plays to or records from, or `undefined`
   * for one the next message will settle.
   */
  device: string | undefined;
};

/** A sound card, and the profiles that say which of its devices are on. */
export type AudioCard = {
  id: string;
  description: string;
  /** Best first. */
  profiles: readonly AudioChoice[];
  /** The {@link AudioChoice.name} of the profile in use. */
  profile: string | undefined;
};
