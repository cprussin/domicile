import { describe, expect, it } from "bun:test";
import type { DomicileClient } from "@domicile/sdk/domicile-client";
import type { AudioMessage } from "@domicile/sdk/host-message";

import { laptop } from "./fixture";
import { watchAudio } from "./watch-audio";

/** The client, as much of it as this touches — see `watch-battery.test.ts`. */
const heldClient = () => {
  const handlers = new Map<string, (message: AudioMessage) => void>();
  return {
    client: {
      on: (type: string, handler: (message: AudioMessage) => void) => {
        handlers.set(type, handler);
      },
    } as unknown as DomicileClient,
    says: (audio: AudioMessage) => {
      handlers.get("audio")?.(audio);
    },
  };
};

describe("watchAudio", () => {
  it("reports the sound to every monitor's bar, late ones too", () => {
    const host = heldClient();
    const first: AudioMessage[] = [];
    const late: AudioMessage[] = [];

    watchAudio(host.client, (audio) => first.push(audio));
    host.says(laptop);
    watchAudio(host.client, (audio) => late.push(audio));

    expect(first).toEqual([laptop]);
    expect(late).toEqual([laptop]);
  });
});
