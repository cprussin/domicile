import { afterEach, describe, expect, it } from "bun:test";

import { bindKeys } from "./bind-keys";
import type { DomicileShortcut } from "./domicile-host";
import type {
  HostMessageOf,
  HostMessageType,
  ShellConfigMessage,
  ShortcutMessage,
} from "./host-message";
import { KeyAction } from "./key-action";
import type { ShellKeybindings } from "./own-keybindings";

/** Meta and the key `keycode`, and nothing else held. */
const meta = (keycode: number, shiftKey = false): ShortcutMessage => ({
  altKey: false,
  ctrlKey: false,
  keycode,
  metaKey: true,
  shiftKey,
});

// The evdev codes of the keys these press: `input.ts`'s numbering, written out
// so the test is not reading the table the code under test reads.
const ENTER = 28;
const ESCAPE = 1;
const R = 19;

/** The shell's keys, as a shell binds them. */
const DESK: ShellKeybindings = {
  keybindings: {
    "Meta+Return": KeyAction.SendShell(["terminal"]),
    "Meta+r": KeyAction.Mode("resize"),
  },
  modes: {
    resize: {
      "Meta+Escape": KeyAction.Mode("default"),
      "Meta+Return": KeyAction.SendShell(["resize", "grow", "right"]),
    },
  },
};

/** The keyboard the compositor describes, the keys above on it. */
const KEYBOARD: ShellConfigMessage = {
  keys: new Map([
    ["Escape", ESCAPE],
    ["Return", ENTER],
    ["r", R],
  ]),
};

/**
 * The two things `bindKeys` uses of a client: its single-slot handlers, and
 * the claim. Messages are handed to whatever registered, as the client does.
 */
class FakeClient {
  readonly grabbed: DomicileShortcut[] = [];
  readonly #handlers = new Map<string, (message: never) => void>();

  on<T extends HostMessageType>(
    type: T,
    handler: (message: HostMessageOf<T>) => void,
  ): this {
    this.#handlers.set(type, handler as (message: never) => void);
    return this;
  }

  off<T extends HostMessageType>(
    type: T,
    handler: (message: HostMessageOf<T>) => void,
  ): this {
    if (this.#handlers.get(type) === handler) {
      this.#handlers.delete(type);
    }
    return this;
  }

  grabShortcut(shortcut: DomicileShortcut): void {
    this.grabbed.push(shortcut);
  }

  emit<T extends HostMessageType>(type: T, message: HostMessageOf<T>): void {
    this.#handlers.get(type)?.(message as never);
  }
}

/** Everything the handlers were told, in order. */
type Heard =
  | readonly ["command", readonly string[]]
  | readonly ["mode", string];

let unbind: () => void = () => undefined;

afterEach(() => {
  unbind();
});

const bound = (own: ShellKeybindings = DESK) => {
  const client = new FakeClient();
  const heard: Heard[] = [];
  const binding = bindKeys(client, own, {
    onCommand: (args) => {
      heard.push(["command", args]);
    },
    onModeChanged: (mode) => {
      heard.push(["mode", mode]);
    },
  });
  unbind = binding.unbind;
  return { client, heard, setMode: binding.setMode };
};

/** A chord pressed on the page, by the key's `code`. */
const pressing = (
  code: string,
  init: KeyboardEventInit = {},
): KeyboardEvent => {
  const event = new KeyboardEvent("keydown", {
    cancelable: true,
    code,
    metaKey: true,
    ...init,
  });
  document.dispatchEvent(event);
  return event;
};

describe("bindKeys", () => {
  describe("the keyboard arriving", () => {
    it("claims every chord of every mode, each once, on its keys", () => {
      const { client } = bound();

      client.emit("shell_config", KEYBOARD);

      expect(client.grabbed).toStrictEqual([
        meta(ENTER),
        meta(R),
        meta(ESCAPE),
      ]);
    });

    it("claims the keys again where a new layout put them", () => {
      // A chord names a keysym: on another layout it is another key.
      const { client } = bound();
      client.emit("shell_config", KEYBOARD);

      client.emit("shell_config", {
        keys: new Map([...KEYBOARD.keys, ["Return", 96]]),
      });

      expect(client.grabbed).toContainEqual(meta(96));
    });

    it("refuses a chord whose keysym the keyboard cannot type, naming it", () => {
      const { client } = bound({
        keybindings: { "Meta+Greek_alpha": KeyAction.Mode("x") },
      });

      expect(() => {
        client.emit("shell_config", KEYBOARD);
      }).toThrow("Greek_alpha");
    });
  });

  describe("a press on the page", () => {
    it("runs the command bound to it, and takes the key from the page", () => {
      const { client, heard } = bound();
      client.emit("shell_config", KEYBOARD);

      const event = pressing("Enter");

      expect(heard).toContainEqual(["command", ["terminal"]]);
      expect(event.defaultPrevented).toBe(true);
    });

    it("leaves a chord nobody bound alone", () => {
      const { client, heard } = bound();
      client.emit("shell_config", KEYBOARD);

      const event = pressing("Enter", { shiftKey: true });

      expect(heard.filter(([kind]) => kind === "command")).toStrictEqual([]);
      expect(event.defaultPrevented).toBe(false);
    });

    it("takes a held key's repeats without running them again", () => {
      const { client, heard } = bound();
      client.emit("shell_config", KEYBOARD);

      const event = pressing("Enter", { repeat: true });

      expect(heard.filter(([kind]) => kind === "command")).toStrictEqual([]);
      expect(event.defaultPrevented).toBe(true);
    });

    it("stops listening once unbound", () => {
      const { client, heard } = bound();
      client.emit("shell_config", KEYBOARD);

      unbind();
      pressing("Enter");

      expect(heard.filter(([kind]) => kind === "command")).toStrictEqual([]);
    });
  });

  describe("a press the host hands back", () => {
    it("runs the command bound to it", () => {
      const { client, heard } = bound();
      client.emit("shell_config", KEYBOARD);

      client.emit("shortcut", meta(ENTER));

      expect(heard).toContainEqual(["command", ["terminal"]]);
    });
  });

  describe("modes", () => {
    it("enters the mode a binding names, tells the shell and reads the keys in it", () => {
      const { client, heard } = bound();
      client.emit("shell_config", KEYBOARD);

      client.emit("shortcut", meta(R));
      pressing("Enter");
      pressing("Escape");
      pressing("Enter");

      expect(heard).toStrictEqual([
        ["mode", "resize"],
        ["command", ["resize", "grow", "right"]],
        ["mode", "default"],
        ["command", ["terminal"]],
      ]);
    });

    it("reads the keys in a mode the shell sets, without telling it back", () => {
      // Another page of the desk entered it: the shell knows already.
      const { client, heard, setMode } = bound();
      client.emit("shell_config", KEYBOARD);

      setMode("resize");
      pressing("Enter");

      expect(heard).toStrictEqual([["command", ["resize", "grow", "right"]]]);
    });

    it("does nothing for the mode the keys are already in", () => {
      const { client, heard, setMode } = bound();
      client.emit("shell_config", KEYBOARD);
      pressing("KeyR");

      setMode("resize");

      expect(heard.filter(([kind]) => kind === "mode")).toStrictEqual([
        ["mode", "resize"],
      ]);
    });

    it("goes back to the default mode for one the shell does not have", () => {
      const { client, heard, setMode } = bound();
      client.emit("shell_config", KEYBOARD);
      pressing("KeyR");

      setMode("move");
      pressing("Enter");

      expect(heard.slice(1)).toStrictEqual([
        ["mode", "default"],
        ["command", ["terminal"]],
      ]);
    });

    it("keeps a mode set before the keyboard arrives, and checks it then", () => {
      // A page can be told the desk's mode before it is told the keyboard.
      const { client, heard, setMode } = bound();

      setMode("resize");
      client.emit("shell_config", KEYBOARD);
      pressing("Enter");

      expect(heard).toStrictEqual([["command", ["resize", "grow", "right"]]]);
    });
  });
});
