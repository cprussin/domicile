import { describe, expect, it } from "bun:test";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import { act, within } from "@testing-library/react";

import { exec } from "./keyboard/commands";
import { applicationsConfigSchema } from "./launcher/applications-config";
import { mountManganese } from "./mount-manganese";

/** A fake desktop describing one screen. */
const onADesk = (): FakeDomicileHost => {
  const fake = new FakeDomicileHost();
  fake.set({
    displays: [
      {
        height: 1080,
        modeHeight: 1080,
        modeWidth: 1920,
        name: "left",
        scale: 1,
        transform: "normal",
        width: 1920,
        x: 0,
        y: 0,
      },
    ],
  });
  return fake;
};

const applications = applicationsConfigSchema.parse(undefined);

describe("mountManganese", () => {
  // A custom bar layout on the stock desktop.
  it("mounts manganese into the root with the bar it is given", async () => {
    const fake = onADesk();
    // Not attached to the document, so it can't leak into later tests.
    const root = document.createElement("div");
    const mounted = await act(() =>
      mountManganese(root, fake.host, {
        applications,
        topBar: {
          left: [<span key="mail">mail 3/12</span>],
          middle: [],
          right: [],
        },
      }),
    );

    expect(root).toContainElement(await within(root).findByText("mail 3/12"));

    // Unmounted so its clocks stop ticking into later tests.
    act(() => {
      mounted.unmount();
    });
  });

  // Custom keybindings replace the defaults.
  it("binds the keys it is given rather than its own", async () => {
    const fake = onADesk();
    const mounted = await act(() =>
      mountManganese(document.createElement("div"), fake.host, {
        applications,
        keybindings: { keybindings: { "Meta+x": exec("kitty") }, modes: {} },
      }),
    );

    expect(fake.calls.filter(([method]) => method === "grabShortcut")).toEqual([
      ["grabShortcut", "Meta+x"],
    ]);

    act(() => {
      mounted.unmount();
    });
  });
});
