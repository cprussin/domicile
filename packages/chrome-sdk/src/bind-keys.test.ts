import { afterEach, describe, expect, it } from "bun:test";

import type { KeyHost } from "./bind-keys";
import { bindKeys } from "./bind-keys";
import { KeyAction } from "./key-action";
import type { ShellKeybindings } from "./own-keybindings";
import { SystemErrorKind } from "./system";

/** The shell's keybindings. */
const DESK: ShellKeybindings = {
  keybindings: {
    "Meta+Return": KeyAction.SendShell(["terminal"]),
    "Meta+r": KeyAction.Mode("resize"),
  },
  modes: {
    resize: {
      "Meta+Escape": KeyAction.Mode("default"),
      "Super+Return": KeyAction.SendShell(["resize", "grow", "right"]),
    },
  },
};

/**
 * A host that records grabs and system calls, and dispatches `shortcut` and
 * `system` events. The engine resolves presses, so `pressed` sends any chord.
 */
class FakeHost extends EventTarget {
  readonly grabbed: string[] = [];
  readonly calls: [id: number, request: unknown][] = [];

  grabShortcut(chord: string): void {
    this.grabbed.push(chord);
  }

  callSystem(id: number, request: string): void {
    this.calls.push([id, JSON.parse(request)]);
  }

  pressed(chord: string): void {
    this.dispatchEvent(Object.assign(new Event("shortcut"), { chord }));
  }

  /** Send a compositor line for system call 1, the one `bindKeys` makes. */
  answer(line: object): void {
    this.dispatchEvent(
      new MessageEvent("system", { data: JSON.stringify({ id: 1, ...line }) }),
    );
  }

  /** Let the system call's promise settle. */
  settled(): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }
}

/** The handler calls, in order. */
type Heard =
  | readonly ["command", readonly string[]]
  | readonly ["mode", string]
  | readonly ["report", unknown];

let unbind: () => void = () => undefined;

afterEach(() => {
  unbind();
});

const bound = (own: ShellKeybindings = DESK) => {
  const host = new FakeHost();
  const heard: Heard[] = [];
  const binding = bindKeys(host as unknown as KeyHost, own, {
    onCommand: (args) => {
      heard.push(["command", args]);
    },
    onModeChanged: (mode) => {
      heard.push(["mode", mode]);
    },
    report: (error) => {
      heard.push(["report", error]);
    },
  });
  unbind = binding.unbind;
  return { heard, host, setMode: binding.setMode };
};

describe("bindKeys", () => {
  it("grabs every chord of every mode, each once, in its one spelling", () => {
    const { host } = bound({
      keybindings: { "Meta+Return": KeyAction.Mode("x") },
      modes: { x: { "Super+Return": KeyAction.Mode("default") } },
    });

    expect(host.grabbed).toStrictEqual(["Meta+Return"]);
  });

  it("refuses a chord written wrong before grabbing anything", () => {
    const host = new FakeHost();
    expect(() =>
      bindKeys(
        host as unknown as KeyHost,
        { keybindings: { "Hyper+l": KeyAction.Mode("x") } },
        {
          onCommand: () => undefined,
          onModeChanged: () => undefined,
          report: () => undefined,
        },
      ),
    ).toThrow("Hyper+l");
    expect(host.grabbed).toStrictEqual([]);
  });

  it("runs the command bound to a press", () => {
    const { heard, host } = bound();

    host.pressed("Meta+Return");

    expect(heard).toStrictEqual([["command", ["terminal"]]]);
  });

  it("leaves a press grabbed as a keycode, or by somebody else, alone", () => {
    const { heard, host } = bound();

    host.pressed("");
    host.pressed("Ctrl+q");

    expect(heard).toStrictEqual([]);
  });

  it("stops listening once unbound", () => {
    const { heard, host } = bound();

    unbind();
    host.pressed("Meta+Return");

    expect(heard).toStrictEqual([]);
  });

  describe("commands from a terminal", () => {
    it("runs a command `domicile send-shell` sent, as its binding would", async () => {
      const { heard, host } = bound();
      host.answer({ reply: { kind: "started" }, type: "system_reply" });
      await host.settled();

      host.answer({
        event: { command: ["focus", "right"], kind: "shell_command" },
        type: "system_event",
      });
      await host.settled();

      expect(host.calls).toStrictEqual([[1, { call: "shell_commands" }]]);
      expect(heard).toStrictEqual([["command", ["focus", "right"]]]);
    });

    it("stops hearing them once unbound", async () => {
      const { host } = bound();
      host.answer({ reply: { kind: "started" }, type: "system_reply" });
      await host.settled();

      unbind();

      expect(host.calls.at(-1)).toStrictEqual([1, { call: "unwatch" }]);
    });

    it("stops hearing them once listening starts, if unbound before", async () => {
      const { host } = bound();

      unbind();
      host.answer({ reply: { kind: "started" }, type: "system_reply" });
      await host.settled();

      expect(host.calls.at(-1)).toStrictEqual([1, { call: "unwatch" }]);
    });

    it("reports a page that cannot hear them, and keeps its keys", async () => {
      const { heard, host } = bound();

      host.answer({
        reply: {
          error: { kind: "other", message: "no" },
          kind: "failed",
        },
        type: "system_reply",
      });
      await host.settled();
      host.pressed("Meta+Return");

      expect(heard).toStrictEqual([
        ["report", { kind: SystemErrorKind.Other, message: "no" }],
        ["command", ["terminal"]],
      ]);
    });
  });

  describe("modes", () => {
    it("enters the mode a binding names, tells the shell and reads the keys in it", () => {
      const { heard, host } = bound({
        ...DESK,
        modes: {
          resize: {
            "Meta+Escape": KeyAction.Mode("default"),
            "Super+Return": KeyAction.SendShell(["resize", "grow", "right"]),
          },
        },
      });

      host.pressed("Meta+r");
      host.pressed("Meta+Return");
      host.pressed("Meta+Escape");
      host.pressed("Meta+Return");

      expect(heard).toStrictEqual([
        ["mode", "resize"],
        ["command", ["resize", "grow", "right"]],
        ["mode", "default"],
        ["command", ["terminal"]],
      ]);
    });

    it("reads the keys in a mode the shell sets, without telling it back", () => {
      // Another page entered the mode, so the shell already knows.
      const { heard, host, setMode } = bound({
        ...DESK,
        modes: { resize: { "Meta+Return": KeyAction.SendShell(["grow"]) } },
      });

      setMode("resize");
      host.pressed("Meta+Return");

      expect(heard).toStrictEqual([["command", ["grow"]]]);
    });

    it("does nothing for the mode the keys are already in", () => {
      const { heard, host, setMode } = bound();
      host.pressed("Meta+r");

      setMode("resize");

      expect(heard).toStrictEqual([["mode", "resize"]]);
    });

    it("goes back to the default mode for one the shell does not have", () => {
      const { heard, host, setMode } = bound();
      host.pressed("Meta+r");

      setMode("move");
      host.pressed("Meta+Return");

      expect(heard.slice(1)).toStrictEqual([
        ["mode", "default"],
        ["command", ["terminal"]],
      ]);
    });
  });
});
