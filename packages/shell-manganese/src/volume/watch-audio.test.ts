import { describe, expect, it } from "bun:test";
import type {
  DomicileAudioDevice,
  DomicileAudioStream,
} from "@domicile-desktop/sdk/domicile-host";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";

import type { Audio } from "./watch-audio";
import { watchAudio } from "./watch-audio";

const SPEAKERS: DomicileAudioDevice = {
  description: "Speakers",
  id: "output:speakers",
  isDefault: true,
  monitor: false,
  muted: false,
  port: "",
  ports: [],
  volume: 0.5,
};

const SONG: DomicileAudioStream = {
  application: "Firefox",
  device: "",
  id: "playback:42",
  muted: false,
  title: "",
  volume: 1,
};

/** A desk with one output playing one stream, as the engine holds it. */
const sounding = (fake: FakeDomicileHost) => {
  fake.set({
    audioCards: [
      { description: "Built-in", id: "card", profile: "", profiles: [] },
    ],
    audioInputs: [],
    audioOutputs: [SPEAKERS],
    audioPlayback: [SONG],
    audioRecording: [],
  });
};

describe("watchAudio", () => {
  it("reports the sound the host holds, and every change after", () => {
    const fake = new FakeDomicileHost();
    sounding(fake);
    const heard: Audio[] = [];

    watchAudio(fake.host, (audio) => {
      heard.push(audio);
    });
    fake.set({ audioOutputs: [{ ...SPEAKERS, volume: 0.6 }] });

    expect(heard.map(({ outputs }) => outputs[0]?.volume)).toEqual([0.5, 0.6]);
  });

  it("reads the engine's empty strings as nothing said", () => {
    const fake = new FakeDomicileHost();
    sounding(fake);
    const heard: Audio[] = [];

    watchAudio(fake.host, (audio) => {
      heard.push(audio);
    });

    expect(heard).toEqual([
      {
        cards: [
          {
            description: "Built-in",
            id: "card",
            profile: undefined,
            profiles: [],
          },
        ],
        inputs: [],
        outputs: [
          {
            default: true,
            description: "Speakers",
            id: "output:speakers",
            monitor: false,
            muted: false,
            port: undefined,
            ports: [],
            volume: 0.5,
          },
        ],
        playback: [
          {
            application: "Firefox",
            device: undefined,
            id: "playback:42",
            muted: false,
            title: undefined,
            volume: 1,
          },
        ],
        recording: [],
      },
    ]);
  });

  it("reports nothing on a desk with no sound server", () => {
    const fake = new FakeDomicileHost();
    const heard: Audio[] = [];

    watchAudio(fake.host, (audio) => {
      heard.push(audio);
    });

    expect(heard).toEqual([]);
  });
});
