import { describe, expect, it } from "bun:test";
import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";
import type { SystemError, SystemHost } from "./system";
import {
  Bus,
  FileType,
  Listened,
  ScreenshotKept,
  Signal,
  SystemErrorKind,
  system,
  UnlockRefusal,
} from "./system";
import { WindowRequest, WindowState } from "./window-state";

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

/** How the browser ends a call whose compositor exited. */
const gone = {
  error: { kind: "compositor_gone", message: "the compositor exited" },
  kind: "failed",
};

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

  it("reads part of a file", async () => {
    const host = new FakeHost();
    const files = system(host);
    const middle = files.readFile("song.flac", { length: 4, offset: 8 });
    const front = files.readFile("song.flac", { length: 4 });
    host.reply(1, { data: base64("fLaC"), kind: "read" });
    host.reply(2, { data: base64("ID3"), kind: "read" });

    expect(host.calls).toStrictEqual([
      [1, { call: "read_file", length: 4, offset: 8, path: "song.flac" }],
      [2, { call: "read_file", length: 4, path: "song.flac" }],
    ]);
    expect(await middle).toStrictEqual(Ok(new TextEncoder().encode("fLaC")));
    expect(await front).toStrictEqual(Ok(new TextEncoder().encode("ID3")));
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
      Listened.Heard("/home/ada/.config/a"),
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
  // See "A compositor restart" in docs/architecture/ENGINE-FORK.md.
  it("watches again under the next compositor when the last one exits", async () => {
    const host = new FakeHost();
    const watching = system(host).watch("/tmp");
    host.reply(1, { kind: "started" });
    const watch = started(await watching);
    host.event(1, { kind: "changed", path: "/tmp/a" });
    host.end(1, gone);
    host.reply(2, { kind: "started" });
    host.event(2, { kind: "changed", path: "/tmp/b" });
    watch.stop();
    host.end(2, { kind: "stopped" });

    expect(host.calls).toStrictEqual([
      [1, { call: "watch", path: "/tmp" }],
      [2, { call: "watch", path: "/tmp" }],
      [2, { call: "unwatch" }],
    ]);
    expect(await Array.fromAsync(watch.items)).toStrictEqual([
      Listened.Heard("/tmp/a"),
      Listened.Missed(),
      Listened.Heard("/tmp/b"),
    ]);
    expect(await watch.ended).toStrictEqual(Ok("stopped"));
  });

  it("asks again when the compositor exits before it answers", async () => {
    const host = new FakeHost();
    const watching = system(host).watch("/tmp");
    host.reply(1, gone);
    host.reply(2, { kind: "started" });

    started(await watching);
    expect(host.calls).toStrictEqual([
      [1, { call: "watch", path: "/tmp" }],
      [2, { call: "watch", path: "/tmp" }],
    ]);
  });

  it("says why the next compositor would not watch", async () => {
    const host = new FakeHost();
    const watching = system(host).watch("/tmp");
    host.reply(1, { kind: "started" });
    const watch = started(await watching);
    host.end(1, gone);
    host.reply(2, {
      error: { kind: "locked", message: "the desktop is locked" },
      kind: "failed",
    });

    expect(await Array.fromAsync(watch.items)).toStrictEqual([]);
    expect(await watch.ended).toStrictEqual(
      Err({ kind: SystemErrorKind.Locked, message: "the desktop is locked" }),
    );
  });

  it("stays stopped when the compositor exits after a stop", async () => {
    const host = new FakeHost();
    const watching = system(host).watch("/tmp");
    host.reply(1, { kind: "started" });
    const watch = started(await watching);
    watch.stop();
    host.end(1, gone);

    expect(host.calls).toStrictEqual([
      [1, { call: "watch", path: "/tmp" }],
      [1, { call: "unwatch" }],
    ]);
    expect(await watch.ended).toStrictEqual(Ok("stopped"));
  });
});

describe("a compositor that exits", () => {
  it("fails a call it had not answered", async () => {
    const host = new FakeHost();
    const reading = system(host).stat("/tmp");
    host.reply(1, gone);

    expect(await reading).toStrictEqual(
      Err({
        kind: SystemErrorKind.CompositorGone,
        message: "the compositor exited",
      }),
    );
  });

  it("ends a process it was running", async () => {
    const host = new FakeHost();
    const spawning = system(host).spawn(["sleep", "9"]);
    host.reply(1, { kind: "started" });
    const process = started(await spawning);
    host.end(1, gone);

    expect(await process.exited).toStrictEqual(
      Err({
        kind: SystemErrorKind.CompositorGone,
        message: "the compositor exited",
      }),
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
      Listened.Heard({
        body: ["org.mpris.MediaPlayer2.Player", {}, []],
        interface: "org.freedesktop.DBus.Properties",
        member: "PropertiesChanged",
        path: "/org/mpris/MediaPlayer2",
        sender: ":1.4",
        signature: "sa{sv}as",
      }),
    ]);
    expect(await match.ended).toStrictEqual(Ok("stopped"));
  });

  // See "A compositor restart" in docs/architecture/ENGINE-FORK.md.
  it("says what it missed while the compositor restarted", async () => {
    const host = new FakeHost();
    const matching = system(host).dbusMatch({ bus: Bus.System });
    host.reply(1, { kind: "started" });
    const match = started(await matching);
    host.end(1, gone);
    host.reply(2, { kind: "started" });
    match.stop();
    host.end(2, { kind: "stopped" });

    expect(await Array.fromAsync(match.items)).toStrictEqual([
      Listened.Missed(),
    ]);
  });
});

describe("screenshots", () => {
  it("says where the screenshot the shell's dialog picked was saved", async () => {
    const host = new FakeHost();
    const taking = system(host).screenshot();
    host.reply(1, { kind: "saved", path: "/home/me/Pictures/a.png" });

    expect(host.calls).toStrictEqual([[1, { call: "screenshot" }]]);
    expect(await taking).toStrictEqual(
      Ok(ScreenshotKept.Saved("/home/me/Pictures/a.png")),
    );
  });

  it("says the screenshot was copied rather than saved", async () => {
    const host = new FakeHost();
    const taking = system(host).screenshot();
    host.reply(1, { kind: "copied" });

    expect(await taking).toStrictEqual(Ok(ScreenshotKept.Copied()));
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

describe("shell commands", () => {
  it("streams each command `domicile send-shell` sends until it is stopped", async () => {
    const host = new FakeHost();
    const listening = system(host).shellCommands();
    host.reply(1, { kind: "started" });
    const commands = started(await listening);
    host.event(1, { command: ["focus", "right"], kind: "shell_command" });
    commands.stop();
    host.end(1, { kind: "stopped" });

    expect(host.calls).toStrictEqual([
      [1, { call: "shell_commands" }],
      [1, { call: "unwatch" }],
    ]);
    expect(await Array.fromAsync(commands.items)).toStrictEqual([
      ["focus", "right"],
    ]);
  });
});

describe("idle warnings", () => {
  it("streams how soon the screens blank, and when they no longer will", async () => {
    const host = new FakeHost();
    const listening = system(host).idleWarnings();
    host.reply(1, { kind: "started" });
    const warnings = started(await listening);
    host.event(1, { blanks_in_ms: 30_000, kind: "idle_warning" });
    host.event(1, { blanks_in_ms: null, kind: "idle_warning" });
    warnings.stop();
    host.end(1, { kind: "stopped" });

    expect(host.calls).toStrictEqual([
      [1, { call: "idle_warnings" }],
      [1, { call: "unwatch" }],
    ]);
    expect(await Array.fromAsync(warnings.items)).toStrictEqual([
      30_000,
      undefined,
    ]);
  });
});

describe("unlock refusals", () => {
  it("streams why each passphrase did not open the desk", async () => {
    const host = new FakeHost();
    const listening = system(host).unlockRefusals();
    host.reply(1, { kind: "started" });
    const refusals = started(await listening);
    for (const refusal of ["wrong_passphrase", "unverifiable", "too_soon"]) {
      host.event(1, {
        failures: 3,
        kind: "unlock_refused",
        refusal,
        retry_in_ms: 5000,
      });
    }
    refusals.stop();
    host.end(1, { kind: "stopped" });

    expect(host.calls[0]).toStrictEqual([1, { call: "unlock_refusals" }]);
    expect(await Array.fromAsync(refusals.items)).toStrictEqual(
      [
        UnlockRefusal.WrongPassphrase,
        UnlockRefusal.Unverifiable,
        UnlockRefusal.TooSoon,
      ].map((refusal) => ({ failures: 3, refusal, retryInMs: 5000 })),
    );
  });
});

describe("window states", () => {
  it("replaces the states the shell set on a window", async () => {
    const host = new FakeHost();
    const setting = system(host).setWindowStates("app-1", [
      WindowState.TiledLeft,
      WindowState.TiledRight,
      WindowState.TiledTop,
      WindowState.TiledBottom,
      WindowState.Maximized,
      WindowState.Fullscreen,
    ]);
    host.reply(1, { kind: "set" });

    expect(host.calls).toStrictEqual([
      [
        1,
        {
          app_id: "app-1",
          call: "set_window_states",
          states: [
            "tiled_left",
            "tiled_right",
            "tiled_top",
            "tiled_bottom",
            "maximized",
            "fullscreen",
          ],
        },
      ],
    ]);
    expect(await setting).toStrictEqual(Ok("set"));
  });

  it("says the compositor knows no such window", async () => {
    const host = new FakeHost();
    const setting = system(host).setWindowStates("gone", []);
    host.reply(1, {
      error: { kind: "not_found", message: "no window gone" },
      kind: "failed",
    });

    expect(await setting).toStrictEqual(
      Err({ kind: SystemErrorKind.NotFound, message: "no window gone" }),
    );
  });

  it("streams each maximize and fullscreen request clients make", async () => {
    const host = new FakeHost();
    const listening = system(host).windowRequests();
    host.reply(1, { kind: "started" });
    const requests = started(await listening);
    for (const request of [
      { kind: "maximize" },
      { kind: "unmaximize" },
      { display: "left", kind: "fullscreen" },
      { display: null, kind: "fullscreen" },
      { kind: "unfullscreen" },
    ]) {
      host.event(1, { app_id: "app-1", kind: "window_request", request });
    }
    requests.stop();
    host.end(1, { kind: "stopped" });

    expect(host.calls).toStrictEqual([
      [1, { call: "window_requests" }],
      [1, { call: "unwatch" }],
    ]);
    expect(await Array.fromAsync(requests.items)).toStrictEqual([
      WindowRequest.Maximize("app-1"),
      WindowRequest.Unmaximize("app-1"),
      WindowRequest.Fullscreen("app-1", "left"),
      WindowRequest.Fullscreen("app-1", undefined),
      WindowRequest.Unfullscreen("app-1"),
    ]);
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
