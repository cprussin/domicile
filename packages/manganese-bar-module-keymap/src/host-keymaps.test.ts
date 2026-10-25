import { describe, expect, it } from "bun:test";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import type { Keymaps } from "@domicile-desktop/sdk/keymap-choice";

import { hostKeymaps } from "./host-keymaps";

/** The system calls the shell made, by id, as the compositor reads them. */
const requests = (fake: FakeDomicileHost): [number, unknown][] =>
  fake.calls
    .filter(([method]) => method === "callSystem")
    .map(([, id, request]) => [Number(id), JSON.parse(String(request))]);

/** Send `message` for call `id` as the compositor would. */
const say = (fake: FakeDomicileHost, id: number, message: object) => {
  fake.dispatch("system", { data: JSON.stringify({ id, ...message }) });
};

/** Let the page's promises settle. */
const settled = () => new Promise((done) => setTimeout(done, 0));

describe("hostKeymaps", () => {
  it("hears the keymaps until the watch stops", async () => {
    const fake = new FakeDomicileHost();
    const heard: Keymaps[] = [];
    const stop = hostKeymaps(fake.host).watch((keymaps) => {
      heard.push(keymaps);
    });
    say(fake, 1, { reply: { kind: "started" }, type: "system_reply" });
    await settled();
    say(fake, 1, {
      event: {
        active: "dvp",
        keymaps: [{ description: "English (programmer Dvorak)", name: "dvp" }],
        kind: "keymaps",
      },
      type: "system_event",
    });
    await settled();

    stop();
    await settled();

    expect(heard).toStrictEqual([
      {
        active: "dvp",
        keymaps: [{ description: "English (programmer Dvorak)", name: "dvp" }],
      },
    ]);
    expect(requests(fake)).toStrictEqual([
      [1, { call: "keymaps" }],
      [1, { call: "unwatch" }],
    ]);
  });
});
