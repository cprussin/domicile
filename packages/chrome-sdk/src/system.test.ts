import { describe, expect, it } from "bun:test";
import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";
import type { SystemError, SystemHost } from "./system";
import { Bus, FileType, Signal, SystemErrorKind, system } from "./system";

/**
 * A desktop that records system calls and answers them as the
 * compositor would, by dispatching `system` events to its listeners.
 */
class FakeHost implements SystemHost {
  readonly calls: [id: number, request: unknown][] = [];
  readonly #listeners: ((event: MessageEvent<string>) => void)[] = [];

  callSystem(id: number, request: string): void {
    this.calls.push([id, JSON.parse(request)]);
  }

  addEventListener(
    type: "system",
    listener: (event: MessageEvent<string>) => void,
  ): void {
    expect(type).toBe("system");
    this.#listeners.push(listener);
  }

  /** Send a compositor line to every listener. */
  answer(line: object): void {
    const event = new MessageEvent("system", { data: JSON.stringify(line) });
    for (const listener of this.#listeners) {
      listener(event);
    }
  }

  reply(id: number, reply: object): void {
    this.answer({ id, reply, type: "system_reply" });
  }

  event(id: number, event: object): void {
    this.answer({ event, id, type: "system_event" });
  }

  end(id: number, end: object): void {
    this.answer({ end, id, type: "system_end" });
  }
}

const base64 = (text: string): string =>
  btoa(String.fromCharCode(...new TextEncoder().encode(text)));

/** The started call, or a failure that names the error. */
const started = <T extends NonNullable<unknown>>(
  result: Result<T, SystemError>,
): T =>
  result.match({
    Err: (error) => {
      throw new Error(`the call failed: ${error.message}`);
    },
    Ok: (value) => value,
  });

const read = async (stream: ReadableStream<Uint8Array>): Promise<string> =>
  new Response(stream).text();

describe("files", () => {
  it("reads a file", async () => {
    const host = new FakeHost();
    const reading = system(host).readFile(
      "/sys/class/power_supply/BAT0/capacity",
    );
    host.reply(1, { data: base64("97\n"), kind: "read" });

    expect(host.calls).toStrictEqual([
      [1, { call: "read_file", path: "/sys/class/power_supply/BAT0/capacity" }],
    ]);
    expect(await reading).toStrictEqual(Ok(new Uint8Array([0x39, 0x37, 0x0a])));
  });

  it("reads a file as text", async () => {
    const host = new FakeHost();
    const reading = system(host).readTextFile("note");
    host.reply(1, { data: base64("héllo"), kind: "read" });

    expect(await reading).toStrictEqual(Ok("héllo"));
  });

  it("says why a call failed", async () => {
    const host = new FakeHost();
    const reading = system(host).readFile("/missing");
    host.reply(1, {
      error: { kind: "not_found", message: "No such file" },
      kind: "failed",
    });

    expect(await reading).toStrictEqual(
      Err({ kind: SystemErrorKind.NotFound, message: "No such file" }),
    );
  });

  it("writes text or bytes as base64", async () => {
    const host = new FakeHost();
    const files = system(host);
    const text = files.writeFile("a", "hi");
    const bytes = files.writeFile("b", new Uint8Array([0xff]), {
      atomic: false,
    });
    host.reply(1, { kind: "written" });
    host.reply(2, { kind: "written" });

    expect(host.calls).toStrictEqual([
      [1, { atomic: true, call: "write_file", data: "aGk=", path: "a" }],
      [2, { atomic: false, call: "write_file", data: "/w==", path: "b" }],
    ]);
    expect(await text).toStrictEqual(Ok("written"));
    expect(await bytes).toStrictEqual(Ok("written"));
  });

  it("lists a directory", async () => {
    const host = new FakeHost();
    const listing = system(host).readDir("/sys/class/power_supply");
    host.reply(1, {
      entries: [
        { file_type: "symlink", name: "BAT0" },
        { file_type: "directory", name: "AC" },
      ],
      kind: "entries",
    });

    expect(await listing).toStrictEqual(
      Ok([
        { fileType: FileType.Symlink, name: "BAT0" },
        { fileType: FileType.Directory, name: "AC" },
      ]),
    );
  });

  it("describes a path", async () => {
    const host = new FakeHost();
    const described = system(host).stat("/sys");
    host.reply(1, {
      file_type: "directory",
      kind: "stat",
      modified_ms: null,
      size: 0,
    });

    expect(await described).toStrictEqual(
      Ok({ fileType: FileType.Directory, modifiedMs: undefined, size: 0 }),
    );
  });
});

describe("processes", () => {
  it("streams a process's output and says how it exited", async () => {
    const host = new FakeHost();
    const spawning = system(host).spawn(["pactl", "subscribe"]);
    host.reply(1, { kind: "started" });
    const process = started(await spawning);
    host.event(1, {
      data: base64("Event 'change'\n"),
      kind: "output",
      stream: "stdout",
    });
    host.event(1, { data: base64("oops\n"), kind: "output", stream: "stderr" });
    host.end(1, { code: 0, kind: "exited", signal: null });

    expect(host.calls).toStrictEqual([
      [
        1,
        { argv: ["pactl", "subscribe"], call: "spawn", env: {}, stdin: false },
      ],
    ]);
    expect(await read(process.stdout)).toBe("Event 'change'\n");
    expect(await read(process.stderr)).toBe("oops\n");
    expect(await process.exited).toStrictEqual(
      Ok({ code: 0, signal: undefined }),
    );
  });

  it("drives a running process by its id", async () => {
    const host = new FakeHost();
    const spawning = system(host).spawn(["cat"], {
      cwd: "/tmp",
      env: { LANG: "C" },
      stdin: true,
    });
    host.reply(1, { kind: "started" });
    const process = started(await spawning);
    process.write("hi");
    process.closeStdin();
    process.kill();
    process.kill(Signal.Kill);

    expect(host.calls).toStrictEqual([
      [
        1,
        {
          argv: ["cat"],
          call: "spawn",
          cwd: "/tmp",
          env: { LANG: "C" },
          stdin: true,
        },
      ],
      [1, { call: "stdin", data: "aGk=" }],
      [1, { call: "close_stdin" }],
      [1, { call: "kill", signal: "term" }],
      [1, { call: "kill", signal: "kill" }],
    ]);
  });

  it("fails to start a program that is not installed", async () => {
    const host = new FakeHost();
    const spawning = system(host).spawn(["nope"]);
    host.reply(1, {
      error: { kind: "not_found", message: "No such file" },
      kind: "failed",
    });

    expect(await spawning).toStrictEqual(
      Err({ kind: SystemErrorKind.NotFound, message: "No such file" }),
    );
  });

  it("runs a program to its end", async () => {
    const host = new FakeHost();
    const running = system(host).run(["pactl", "-f", "json", "info"]);
    host.reply(1, { kind: "started" });
    host.event(1, { data: base64("{}"), kind: "output", stream: "stdout" });
    host.end(1, { code: null, kind: "exited", signal: 15 });

    expect(await running).toStrictEqual(
      Ok({ code: undefined, signal: 15, stderr: "", stdout: "{}" }),
    );
  });
});

describe("watches", () => {
  it("streams changes until it is stopped", async () => {
    const host = new FakeHost();
    const watching = system(host).watch("/home/ada/.config");
    host.reply(1, { kind: "started" });
    const watch = started(await watching);
    host.event(1, { kind: "changed", path: "/home/ada/.config/a" });
    watch.stop();
    host.end(1, { kind: "stopped" });

    expect(host.calls).toStrictEqual([
      [1, { call: "watch", path: "/home/ada/.config" }],
      [1, { call: "unwatch" }],
    ]);
    expect(await Array.fromAsync(watch.items)).toStrictEqual([
      "/home/ada/.config/a",
    ]);
    expect(await watch.ended).toStrictEqual(Ok("stopped"));
  });

  it("says why a watch broke", async () => {
    const host = new FakeHost();
    const watching = system(host).watch("/tmp");
    host.reply(1, { kind: "started" });
    const watch = started(await watching);
    host.end(1, {
      error: { kind: "other", message: "the watch broke" },
      kind: "failed",
    });

    expect(await watch.ended).toStrictEqual(
      Err({ kind: SystemErrorKind.Other, message: "the watch broke" }),
    );
  });
});

describe("D-Bus", () => {
  it("calls a method with a typed body", async () => {
    const host = new FakeHost();
    const calling = system(host).dbusCall({
      body: ["org.freedesktop.UPower.Device"],
      bus: Bus.System,
      destination: "org.freedesktop.UPower",
      interface: "org.freedesktop.DBus.Properties",
      member: "GetAll",
      path: "/org/freedesktop/UPower/devices/DisplayDevice",
      signature: "s",
    });
    host.reply(1, {
      body: JSON.stringify([{ Percentage: { signature: "d", value: 97 } }]),
      kind: "returned",
      signature: "a{sv}",
    });

    expect(host.calls).toStrictEqual([
      [
        1,
        {
          body: '["org.freedesktop.UPower.Device"]',
          bus: "system",
          call: "dbus_call",
          destination: "org.freedesktop.UPower",
          interface: "org.freedesktop.DBus.Properties",
          member: "GetAll",
          path: "/org/freedesktop/UPower/devices/DisplayDevice",
          signature: "s",
        },
      ],
    ]);
    expect(await calling).toStrictEqual(
      Ok({
        body: [{ Percentage: { signature: "d", value: 97 } }],
        signature: "a{sv}",
      }),
    );
  });

  it("names a method's error", async () => {
    const host = new FakeHost();
    const calling = system(host).dbusCall({
      bus: Bus.Session,
      destination: "org.example",
      interface: "org.example",
      member: "Nothing",
      path: "/",
    });
    host.reply(1, {
      error: {
        kind: "dbus",
        message: "org.freedesktop.DBus.Error.UnknownMethod",
      },
      kind: "failed",
    });

    expect(host.calls[0]?.[1]).toMatchObject({ body: "[]", signature: "" });
    expect(await calling).toStrictEqual(
      Err({
        kind: SystemErrorKind.Dbus,
        message: "org.freedesktop.DBus.Error.UnknownMethod",
      }),
    );
  });

  it("streams the signals a match names until it is stopped", async () => {
    const host = new FakeHost();
    const matching = system(host).dbusMatch({
      bus: Bus.Session,
      interface: "org.freedesktop.DBus.Properties",
      member: "PropertiesChanged",
    });
    host.reply(1, { kind: "started" });
    const match = started(await matching);
    host.event(1, {
      body: '["org.mpris.MediaPlayer2.Player",{},[]]',
      interface: "org.freedesktop.DBus.Properties",
      kind: "signal",
      member: "PropertiesChanged",
      path: "/org/mpris/MediaPlayer2",
      sender: ":1.4",
      signature: "sa{sv}as",
    });
    match.stop();
    host.end(1, { kind: "stopped" });

    expect(host.calls).toStrictEqual([
      [
        1,
        {
          bus: "session",
          call: "dbus_match",
          interface: "org.freedesktop.DBus.Properties",
          member: "PropertiesChanged",
        },
      ],
      [1, { call: "unwatch" }],
    ]);
    expect(await Array.fromAsync(match.items)).toStrictEqual([
      {
        body: ["org.mpris.MediaPlayer2.Player", {}, []],
        interface: "org.freedesktop.DBus.Properties",
        member: "PropertiesChanged",
        path: "/org/mpris/MediaPlayer2",
        sender: ":1.4",
        signature: "sa{sv}as",
      },
    ]);
    expect(await match.ended).toStrictEqual(Ok("stopped"));
  });
});

describe("screenshots", () => {
  it("says where the screenshot the shell's dialog picked was saved", async () => {
    const host = new FakeHost();
    const taking = system(host).screenshot();
    host.reply(1, { kind: "saved", path: "/home/me/Pictures/a.png" });

    expect(host.calls).toStrictEqual([[1, { call: "screenshot" }]]);
    expect(await taking).toStrictEqual(Ok("/home/me/Pictures/a.png"));
  });

  it("says the dialog was dismissed", async () => {
    const host = new FakeHost();
    const taking = system(host).screenshot();
    host.reply(1, {
      error: { kind: "canceled", message: "dismissed" },
      kind: "failed",
    });

    expect(await taking).toStrictEqual(
      Err({ kind: SystemErrorKind.Canceled, message: "dismissed" }),
    );
  });
});

describe("ids", () => {
  // The compositor names calls per connection, and a page has one.
  it("are shared by every system on one host", () => {
    const host = new FakeHost();
    system(host)
      .stat("/a")
      .catch(() => {
        /* never answered */
      });
    system(host)
      .stat("/b")
      .catch(() => {
        /* never answered */
      });

    expect(host.calls.map(([id]) => id)).toStrictEqual([1, 2]);
  });
});
