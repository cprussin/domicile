import type { AudioDevice, AudioStream } from "@domicile-desktop/sdk/audio";
import type { DomicileClient } from "@domicile-desktop/sdk/domicile-client";
import type {
  AudioLevelsMessage,
  AudioMessage,
} from "@domicile-desktop/sdk/host-message";
import { act } from "@testing-library/react";

/** An audio device with test overrides. */
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

/** An audio stream with test overrides. */
export const stream = (overrides: Partial<AudioStream>): AudioStream => ({
  application: "Firefox",
  device: "output:speakers",
  id: "playback:42",
  muted: false,
  title: "A song",
  volume: 1,
  ...overrides,
});

/** Laptop audio: speakers, headphones, a microphone and one playing stream. */
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

/** One audio request the shell made: method name and arguments. */
export type Asked = readonly [method: string, ...args: unknown[]];

/**
 * A fake audio host for tests.
 *
 * - `watch` and `watchLevels` replace the real watchers.
 * - `report` and `levels` send host messages.
 * - `asked` and `metered` record the shell's requests.
 */
export const heldSound = () => {
  const listeners: ((audio: AudioMessage) => void)[] = [];
  const meters: ((levels: AudioLevelsMessage) => void)[] = [];
  const asked: Asked[] = [];
  /** Each set of ids the shell asked to meter, in order. */
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
    /** Sends a level for each metered id. */
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
