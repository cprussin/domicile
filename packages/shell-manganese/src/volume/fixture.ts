import type { AudioDevice, AudioStream } from "@domicile-desktop/sdk/audio";
import type { DomicileClient } from "@domicile-desktop/sdk/domicile-client";
import type {
  AudioLevelsMessage,
  AudioMessage,
} from "@domicile-desktop/sdk/host-message";
import { act } from "@testing-library/react";

/** A device, with whatever a test says differently. */
export const device = (overrides: Partial<AudioDevice>): AudioDevice => ({
  default: false,
  description: "Speakers",
  id: "output:speakers",
  monitor: false,
  muted: false,
  port: undefined,
  ports: [],
  volume: 0.5,
  ...overrides,
});

/** A stream, likewise. */
export const stream = (overrides: Partial<AudioStream>): AudioStream => ({
  application: "Firefox",
  device: "output:speakers",
  id: "playback:42",
  muted: false,
  title: "A song",
  volume: 1,
  ...overrides,
});

/** A laptop's sound: speakers, headphones, a microphone, a song playing. */
export const laptop: AudioMessage = {
  cards: [
    {
      description: "Built-in Audio",
      id: "alsa_card.pci",
      profile: "output:analog-stereo",
      profiles: [
        {
          available: true,
          description: "Analog Stereo Output",
          name: "output:analog-stereo",
        },
        { available: true, description: "Off", name: "off" },
      ],
    },
  ],
  inputs: [
    device({
      description: "Monitor of Speakers",
      id: "input:speakers.monitor",
      monitor: true,
      volume: 1,
    }),
    device({
      default: true,
      description: "Microphone",
      id: "input:mic",
      volume: 0.3,
    }),
  ],
  outputs: [
    device({
      default: true,
      port: "analog-output-speaker",
      ports: [
        {
          available: true,
          description: "Speakers",
          name: "analog-output-speaker",
        },
        {
          available: false,
          description: "Headphones",
          name: "analog-output-headphones",
        },
      ],
    }),
    device({ description: "HDMI", id: "output:hdmi", volume: 1 }),
  ],
  playback: [stream({})],
  recording: [
    stream({
      application: "Recorder",
      device: "input:mic",
      id: "recording:7",
      title: undefined,
    }),
  ],
};

/** One thing the shell asked of the desk's sound. */
export type Asked = readonly [method: string, ...args: unknown[]];

/**
 * A sound server the test holds the wire to: `watch` stands in for the
 * host's, `report` is the compositor saying the sound, and `asked` is every
 * request the shell made.
 */
export const heldSound = () => {
  const listeners: ((audio: AudioMessage) => void)[] = [];
  const meters: ((levels: AudioLevelsMessage) => void)[] = [];
  const asked: Asked[] = [];
  /** Every set of ids the shell asked to meter, in order. */
  const metered: (readonly string[])[] = [];
  const record =
    (method: string) =>
    (...args: unknown[]) => {
      asked.push([method, ...args]);
    };
  return {
    asked,
    domicile: {
      moveAudioStream: record("moveAudioStream"),
      setAudioMuted: record("setAudioMuted"),
      setAudioPort: record("setAudioPort"),
      setAudioProfile: record("setAudioProfile"),
      setAudioVolume: record("setAudioVolume"),
      setDefaultAudioDevice: record("setDefaultAudioDevice"),
      watchAudioLevels: (ids: readonly string[]) => {
        metered.push(ids);
      },
    } as unknown as DomicileClient,
    /** The compositor saying how loud each metered id is. */
    levels: (levels: ReadonlyMap<string, number>) => {
      act(() => {
        for (const onLevels of meters) {
          onLevels({ levels });
        }
      });
    },
    metered,
    report: (audio: AudioMessage) => {
      act(() => {
        for (const onAudio of listeners) {
          onAudio(audio);
        }
      });
    },
    watch: (
      _domicile: DomicileClient,
      onAudio: (audio: AudioMessage) => void,
    ) => {
      listeners.push(onAudio);
      return () => undefined;
    },
    watchLevels: (
      _domicile: DomicileClient,
      onLevels: (levels: AudioLevelsMessage) => void,
    ) => {
      meters.push(onLevels);
      return () => undefined;
    },
  };
};
