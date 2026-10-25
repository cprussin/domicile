import { describe, expect, it } from "bun:test";
import { FakeDomicileHost } from "../fake-host";
import { PreviewedWindow } from "../previewed-window";
import { Bus } from "../system";
import { desktop } from "./desktop";

/** The requests sent through `callSystem`, parsed. */
const requests = (fake: FakeDomicileHost): unknown[] =>
  fake.calls.map(([method, , request]) => {
    expect(method).toBe("callSystem");
    return JSON.parse(String(request));
  });

const never = () => {
  /* never answered */
};

describe("files", () => {
  it("calls the compositor for each file call", async () => {
    const fake = new FakeDomicileHost();
    const { files } = desktop(fake.host);
    files.read("a", { length: 4 }).catch(never);
    files.readText("b").catch(never);
    files.write("c", "x").catch(never);
    files.createDir("d").catch(never);
    files.readDir("e").catch(never);
    files.stat("f").catch(never);
    files.watch("g").catch(never);
    await Promise.resolve();

    expect(requests(fake).map((request) => Object(request).call)).toStrictEqual(
      [
        "read_file",
        "read_file",
        "write_file",
        "create_dir",
        "read_dir",
        "stat",
        "watch",
      ],
    );
  });

  it("searches the home's index", () => {
    const fake = new FakeDomicileHost();
    desktop(fake.host).files.search("notes").catch(never);

    expect(fake.calls).toStrictEqual([["searchFiles", "notes"]]);
  });
});

describe("processes", () => {
  it("spawns and runs through the compositor", async () => {
    const fake = new FakeDomicileHost();
    const { processes } = desktop(fake.host);
    processes.spawn(["cat"]).catch(never);
    processes.run(["true"]).catch(never);
    await Promise.resolve();

    expect(requests(fake).map((request) => Object(request).call)).toStrictEqual(
      ["spawn", "spawn"],
    );
  });

  it("launches a program it does not wait on", () => {
    const fake = new FakeDomicileHost();
    desktop(fake.host).processes.launch(["firefox"]);

    expect(fake.calls).toStrictEqual([["spawn", ["firefox"]]]);
  });
});

describe("dbus", () => {
  it("calls and matches through the compositor", async () => {
    const fake = new FakeDomicileHost();
    const { dbus } = desktop(fake.host);
    dbus
      .call({
        bus: Bus.Session,
        destination: "org.freedesktop.DBus",
        interface: "org.freedesktop.DBus",
        member: "ListNames",
        path: "/org/freedesktop/DBus",
      })
      .catch(never);
    dbus.match({ bus: Bus.System }).catch(never);
    await Promise.resolve();

    expect(requests(fake).map((request) => Object(request).call)).toStrictEqual(
      ["dbus_call", "dbus_match"],
    );
  });
});

describe("capture", () => {
  it("takes a screenshot, previews a window and records the screen through the compositor", async () => {
    const fake = new FakeDomicileHost();
    const { capture } = desktop(fake.host);
    capture.screenshot().catch(never);
    capture.preview(PreviewedWindow.App("1")).catch(never);
    capture.screenRecord().catch(never);
    await Promise.resolve();

    expect(requests(fake).map((request) => Object(request).call)).toStrictEqual(
      ["screenshot", "preview_window", "screen_record"],
    );
  });
});
