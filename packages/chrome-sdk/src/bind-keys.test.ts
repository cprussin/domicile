import { afterEach, describe, expect, it } from "bun:test";

import type { KeyDesktop } from "./bind-keys";
import { bindKeys } from "./bind-keys";
import type { Gesture } from "./desktop/gestures";
import { gestures } from "./desktop/gestures";
import { keyboard } from "./desktop/keyboard";
import { shell } from "./desktop/shell";
import { system } from "./desktop/system-calls";
import type { DomicileHost } from "./domicile-host";
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
  readonly ungrabbed: string[] = [];
  readonly grabbedGestures: string[] = [];
  readonly ungrabbedGestures: string[] = [];
  readonly calls: [id: number, request: unknown][] = [];

  grabShortcut(chord: string): void {
    this.grabbed.push(chord);
  }

  ungrabShortcut(chord: string): void {
    this.ungrabbed.push(chord);
  }

  grabGesture(gesture: string): void {
    this.grabbedGestures.push(gesture);
  }

  ungrabGesture(gesture: string): void {
    this.ungrabbedGestures.push(gesture);
  }

  /** Send a whole gesture: its begin, one update, and an end. */
  gestured(
    kind: Gesture["kind"],
    fingers: number,
    update: Partial<Gesture>,
    canceled = false,
  ): void {
    const base = {
      canceled: false,
      dx: 0,
      dy: 0,
      fingers,
      kind,
      rotation: 0,
      scale: 1,
    };
    for (const phase of [
      { ...base, phase: "begin" },
      { ...base, ...update, phase: "update" },
      { ...base, canceled, phase: "end" },
    ]) {
      this.dispatchEvent(Object.assign(new Event("gesture"), phase));
    }
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

/** The desktop's keys and shell commands, as `desktop` makes them. */
const keysOf = (fake: FakeHost): KeyDesktop => {
  const host = fake as unknown as DomicileHost;
  const calls = system(host);
  return {
    gestures: gestures(host),
    keyboard: keyboard(host, calls),
    shell: shell(host, calls),
  };
};

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
  const binding = bindKeys(keysOf(host), own, {
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
        keysOf(host),
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

  it("gives back every chord it grabbed once unbound, and only once", () => {
    const { host } = bound({
      keybindings: {
        "Meta+Return": KeyAction.Mode("x"),
      },
      modes: { x: { "Meta+Escape": KeyAction.Mode("default") } },
    });

    unbind();
    unbind();

    expect(host.ungrabbed).toStrictEqual(["Meta+Return", "Meta+Escape"]);
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

  describe("gestures", () => {
    const SWIPES: ShellKeybindings = {
      keybindings: {
        "Meta+r": KeyAction.Mode("resize"),
        "pinch:4:inward": KeyAction.SendShell(["overview"]),
        "swipe:3:left": KeyAction.SendShell(["workspace", "next"]),
        "swipe:3:right": KeyAction.SendShell(["workspace", "prev"]),
      },
      modes: {
        resize: {
          "Meta+Escape": KeyAction.Mode("default"),
          "swipe:left": KeyAction.SendShell(["resize", "shrink", "width"]),
        },
      },
    };

    it("grabs each gesture's kind and count once, not its direction", () => {
      const { host } = bound(SWIPES);

      expect(host.grabbed).toStrictEqual(["Meta+r", "Meta+Escape"]);
      expect(host.grabbedGestures).toStrictEqual([
        "pinch:4",
        "swipe:3",
        "swipe",
      ]);
    });

    it("runs the binding a finished gesture fits", () => {
      const { heard, host } = bound(SWIPES);

      host.gestured("swipe", 3, { dx: -40, dy: 3 });
      host.gestured("pinch", 4, { scale: 0.5 });
      host.gestured("swipe", 4, { dx: -40 });

      expect(heard).toStrictEqual([
        ["command", ["workspace", "next"]],
        ["command", ["overview"]],
      ]);
    });

    it("runs nothing for a canceled gesture", () => {
      const { heard, host } = bound(SWIPES);

      host.gestured("swipe", 3, { dx: -40 }, true);

      expect(heard).toStrictEqual([]);
    });

    it("reads gestures in the mode the keys are in", () => {
      const { heard, host } = bound(SWIPES);

      host.pressed("Meta+r");
      host.gestured("swipe", 4, { dx: -40 });
      host.gestured("swipe", 3, { dx: 40 });

      expect(heard).toStrictEqual([
        ["mode", "resize"],
        ["command", ["resize", "shrink", "width"]],
      ]);
    });

    it("gives every gesture back once unbound, and stops listening", () => {
      const { heard, host } = bound(SWIPES);

      unbind();
      unbind();
      host.gestured("swipe", 3, { dx: -40 });

      expect(host.ungrabbedGestures).toStrictEqual([
        "pinch:4",
        "swipe:3",
        "swipe",
      ]);
      expect(heard).toStrictEqual([]);
    });
  });
});
