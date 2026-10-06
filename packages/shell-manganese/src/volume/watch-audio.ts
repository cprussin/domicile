import type {
  AudioCard,
  AudioChoice,
  AudioDevice,
  AudioStream,
} from "@domicile-desktop/sdk/audio";
import type {
  DomicileAudioChoice,
  DomicileAudioDevice,
  DomicileAudioStream,
  DomicileHost,
} from "@domicile-desktop/sdk/domicile-host";

import { watchHost } from "../host/watch-host";

/** The desk's audio: every output, input, stream and card. */
export type Audio = {
  outputs: readonly AudioDevice[];
  inputs: readonly AudioDevice[];
  playback: readonly AudioStream[];
  recording: readonly AudioStream[];
  cards: readonly AudioCard[];
};

/**
 * Calls `onAudio` with all devices, streams and cards as soon as the host has
 * them and on every change. Returns an unsubscribe function.
 *
 * `onAudio` is never called without a sound server.
 */
export const watchAudio = (
  domicile: DomicileHost,
  onAudio: (audio: Audio) => void,
): (() => void) => watchHost(domicile, "audiochanged", audioOf, onAudio);

/**
 * The host's audio state, or `undefined` before it has any. Empty strings (a
 * device with no ports, a stream with no title) become `undefined`, and
 * `isDefault` becomes `default`.
 */
const audioOf = ({
  audioCards,
  audioInputs,
  audioOutputs,
  audioPlayback,
  audioRecording,
}: DomicileHost): Audio | undefined =>
  audioCards === null ||
  audioInputs === null ||
  audioOutputs === null ||
  audioPlayback === null ||
  audioRecording === null
    ? undefined
    : {
        cards: audioCards.map((card) => ({
          description: card.description,
          id: card.id,
          profile: named(card.profile),
          profiles: card.profiles.map(choice),
        })),
        inputs: audioInputs.map(device),
        outputs: audioOutputs.map(device),
        playback: audioPlayback.map(stream),
        recording: audioRecording.map(stream),
      };

const choice = ({
  available,
  description,
  name,
}: DomicileAudioChoice): AudioChoice => ({ available, description, name });

const device = (engine: DomicileAudioDevice): AudioDevice => ({
  default: engine.isDefault,
  description: engine.description,
  id: engine.id,
  monitor: engine.monitor,
  muted: engine.muted,
  port: named(engine.port),
  ports: engine.ports.map(choice),
  volume: engine.volume,
});

const stream = (engine: DomicileAudioStream): AudioStream => ({
  application: engine.application,
  device: named(engine.device),
  id: engine.id,
  muted: engine.muted,
  title: named(engine.title),
  volume: engine.volume,
});

/** A value, or `undefined` for the engine's empty string. */
const named = (value: string): string | undefined =>
  value === "" ? undefined : value;
