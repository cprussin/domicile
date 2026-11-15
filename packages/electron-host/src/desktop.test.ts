import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import type { MessageBus } from "dbus-next";
import { sessionBus } from "dbus-next";
import { chooseFile, chooseFileCommand } from "./desktop";
import { startFakeDesktopBus } from "./desktop-bus-fixture";

describe("the file chooser", () => {
  let desktopBus: Awaited<ReturnType<typeof startFakeDesktopBus>>;
  let bus: MessageBus;
  beforeAll(async () => {
    desktopBus = await startFakeDesktopBus({ colorScheme: 0, contrast: 0 });
    bus = sessionBus({ busAddress: desktopBus.address });
  });
  afterAll(async () => {
    bus.disconnect();
    await desktopBus.close();
  });

  it("asks the portal and answers with its response", async () => {
    desktopBus.chooser.answer = { response: 0, uris: ["file:///tmp/a.png"] };

    expect(
      await chooseFile(bus, "OpenFile", "Attach", {
        current_folder: ["ay", [...Buffer.from("/tmp\0")]],
        multiple: ["b", true],
      }),
    ).toEqual({ response: 0, uris: ["file:///tmp/a.png"] });
    const asked = desktopBus.chooser.asked.at(-1);
    expect(asked?.method).toBe("OpenFile");
    expect(asked?.title).toBe("Attach");
    expect(asked?.options.multiple).toBe(true);
    expect(Buffer.from(asked?.options.current_folder as Buffer)).toEqual(
      Buffer.from("/tmp\0"),
    );
  });

  it("answers a cancel with no URIs", async () => {
    desktopBus.chooser.answer = { response: 1, uris: [] };

    expect(await chooseFile(bus, "SaveFile", "Save", {})).toEqual({
      response: 1,
      uris: [],
    });
  });

  // chooseFileSync runs this command and blocks on it; this test can't block,
  // since it serves the portal itself, so it runs the command the same way
  // without blocking.
  it("has a command that asks once and prints the answer", async () => {
    desktopBus.chooser.answer = { response: 0, uris: ["file:///tmp/b.txt"] };

    const child = Bun.spawn(
      chooseFileCommand(desktopBus.address, "SaveFile", "Save", {
        current_name: ["s", "b.txt"],
      }),
      {
        stderr: "inherit",
        stdout: "pipe",
      },
    );

    expect(JSON.parse(await new Response(child.stdout).text())).toEqual({
      response: 0,
      uris: ["file:///tmp/b.txt"],
    });
    expect(await child.exited).toBe(0);
    expect(desktopBus.chooser.asked.at(-1)?.options.current_name).toBe("b.txt");
  });
});
