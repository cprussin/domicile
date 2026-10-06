import { describe, expect, it } from "bun:test";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";

import type { AudioLevels } from "./watch-audio-levels";
import { watchAudioLevels } from "./watch-audio-levels";

describe("watchAudioLevels", () => {
  it("reports each peak the host says, by id, until it is stopped", () => {
    const fake = new FakeDomicileHost();
    const heard: AudioLevels[] = [];
    const stop = watchAudioLevels(fake.host, (levels) => {
      heard.push(levels);
    });

    fake.dispatch("audiolevels", { levels: [{ id: "input:mic", peak: 0.5 }] });
    stop();
    fake.dispatch("audiolevels", { levels: [{ id: "input:mic", peak: 1 }] });

    expect(heard).toEqual([new Map([["input:mic", 0.5]])]);
  });
});
