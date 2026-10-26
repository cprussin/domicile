import { describe, expect, it } from "bun:test";
import { DomicileProvider } from "@domicile-desktop/react/domicile-provider";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Keymap } from "./bar-item";
import { KeymapOptionsContext } from "./keymap-options";

/** The item on a desktop typing on `active` of dvp and us. */
const onADesktopTyping = async (active: string, hideDefault: boolean) => {
  const fake = new FakeDomicileHost();
  render(
    <DomicileProvider domicile={fake.domicile}>
      <KeymapOptionsContext value={{ hideDefault }}>
        <Keymap />
      </KeymapOptionsContext>
    </DomicileProvider>,
  );
  const say = (message: object) => {
    fake.dispatch("system", { data: JSON.stringify({ id: 1, ...message }) });
  };
  await act(async () => {
    say({ reply: { kind: "started" }, type: "system_reply" });
    await new Promise((done) => setTimeout(done, 0));
    say({
      event: {
        active,
        keymaps: [{ name: "dvp" }, { name: "us" }],
        kind: "keymaps",
      },
      type: "system_event",
    });
    await new Promise((done) => setTimeout(done, 0));
  });
  return fake;
};

describe("Keymap", () => {
  it("shows the desktop's keymap", async () => {
    await onADesktopTyping("dvp", false);

    expect(screen.getByRole("button", { name: "Keymap: dvp" })).toBeVisible();
  });

  it("follows the shell's `keymap.hideDefault` option", async () => {
    await onADesktopTyping("dvp", true);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("switches to the keymap picked", async () => {
    const fake = await onADesktopTyping("dvp", false);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Keymap: dvp" }));
    await user.click(await screen.findByRole("radio", { name: "us" }));

    expect(
      fake.calls
        .filter(([method]) => method === "callSystem")
        .map(([, , request]) => JSON.parse(String(request))),
    ).toContainEqual({
      call: "select_keymap",
      keymap: { kind: "named", name: "us" },
    });
  });
});
