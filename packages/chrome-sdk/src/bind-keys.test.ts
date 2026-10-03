import { afterEach, describe, expect, it } from "bun:test";

import { bindKeys } from "./bind-keys";
import type { DomicileShortcut } from "./domicile-host";
import type {
  HostMessageOf,
  HostMessageType,
  KeybindingsByMode,
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

/** The desk's bindings, as the compositor would send them. */
const DESK: KeybindingsByMode = new Map([
  [
    "default",
    [
      { action: KeyAction.SendShell(["terminal"]), shortcut: meta(ENTER) },
      { action: KeyAction.Mode("resize"), shortcut: meta(R) },
    ],
  ],
  [
    "resize",
    [
      {
        action: KeyAction.SendShell(["resize", "grow", "right"]),
        shortcut: meta(ENTER),
      },
      { action: KeyAction.Mode("default"), shortcut: meta(ESCAPE) },
    ],
  ],
]);

/** The keyboard the compositor describes, for the keys a shell binds itself. */
const KEYS: ShellConfigMessage["keys"] = new Map([
  ["Escape", ESCAPE],
  ["Return", ENTER],
  ["r", R],
]);

const configOf = (
  keybindings: KeybindingsByMode,
  shells: ShellConfigMessage["shells"] = new Map(),
): ShellConfigMessage => ({ keybindings, keys: KEYS, shells });

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
  | readonly ["mode", string]
  | readonly ["options", unknown];

let unbind: () => void = () => undefined;

afterEach(() => {
  unbind();
});

const bound = (shell = "manganese", own: ShellKeybindings = {}) => {
  const client = new FakeClient();
  const heard: Heard[] = [];
  const binding = bindKeys(client, shell, own, {
    onCommand: (args) => {
      heard.push(["command", args]);
    },
    onModeChanged: (mode) => {
      heard.push(["mode", mode]);
    },
    onOptions: (options) => {
      heard.push(["options", options]);
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
  describe("the shell's own keys", () => {
    it("claims them, resolved on the keyboard the config arrives with", () => {
      const { client } = bound("manganese", {
        keybindings: { "Meta+Return": KeyAction.SendShell(["terminal"]) },
      });

      client.emit("shell_config", configOf(new Map([["default", []]])));

      expect(client.grabbed).toStrictEqual([meta(ENTER)]);
    });

    it("answers them like the config's", () => {
      const { client, heard } = bound("manganese", {
        keybindings: { "Meta+r": KeyAction.Mode("resize") },
        modes: { resize: { "Meta+Return": KeyAction.SendShell(["grow"]) } },
      });
      client.emit("shell_config", configOf(new Map([["default", []]])));

      client.emit("shortcut", meta(R));
      client.emit("shortcut", meta(ENTER));

      expect(heard).toContainEqual(["mode", "resize"]);
      expect(heard).toContainEqual(["command", ["grow"]]);
    });

    it("lets the config's binding win a chord both bind", () => {
      const { client, heard } = bound("manganese", {
        keybindings: { "Meta+Return": KeyAction.SendShell(["shell's"]) },
      });
      client.emit("shell_config", configOf(DESK));

      client.emit("shortcut", meta(ENTER));

      expect(heard).toContainEqual(["command", ["terminal"]]);
      expect(heard).not.toContainEqual(["command", ["shell's"]]);
    });
  });

  describe("a config arriving", () => {
    it("claims every chord of every mode, each once", () => {
      const { client } = bound();

      client.emit("shell_config", configOf(DESK));

      expect(client.grabbed).toStrictEqual([
        meta(ENTER),
        meta(R),
        meta(ESCAPE),
      ]);
    });

    it("hands the shell its own options, and an empty table when it has none", () => {
      const { client, heard } = bound();

      client.emit(
        "shell_config",
        configOf(
          DESK,
          new Map([
            [
              "manganese",
              { keybindings: new Map([["default", []]]), options: { gaps: 8 } },
            ],
          ]),
        ),
      );
      client.emit("shell_config", configOf(DESK));

      expect(heard).toStrictEqual([
        ["options", { gaps: 8 }],
        ["options", {}],
      ]);
    });

    it("goes back to the default mode when the one the keys are in is gone", () => {
      const { client, heard } = bound();
      client.emit("shell_config", configOf(DESK));
      pressing("KeyR");

      client.emit(
        "shell_config",
        configOf(new Map([["default", [...(DESK.get("default") ?? [])]]])),
      );

      expect(heard.filter(([kind]) => kind === "mode")).toStrictEqual([
        ["mode", "resize"],
        ["mode", "default"],
      ]);
    });
  });

  describe("a press on the page", () => {
    it("runs the command bound to it, and takes the key from the page", () => {
      const { client, heard } = bound();
      client.emit("shell_config", configOf(DESK));

      const event = pressing("Enter");

      expect(heard).toContainEqual(["command", ["terminal"]]);
      expect(event.defaultPrevented).toBe(true);
    });

    it("leaves a chord nobody bound alone", () => {
      const { client, heard } = bound();
      client.emit("shell_config", configOf(DESK));

      const event = pressing("Enter", { shiftKey: true });

      expect(heard.filter(([kind]) => kind === "command")).toStrictEqual([]);
      expect(event.defaultPrevented).toBe(false);
    });

    it("takes a held key's repeats without running them again", () => {
      const { client, heard } = bound();
      client.emit("shell_config", configOf(DESK));

      const event = pressing("Enter", { repeat: true });

      expect(heard.filter(([kind]) => kind === "command")).toStrictEqual([]);
      expect(event.defaultPrevented).toBe(true);
    });

    it("stops listening once unbound", () => {
      const { client, heard } = bound();
      client.emit("shell_config", configOf(DESK));

      unbind();
      pressing("Enter");

      expect(heard.filter(([kind]) => kind === "command")).toStrictEqual([]);
    });
  });

  describe("a press the host hands back", () => {
    it("runs the command bound to it", () => {
      const { client, heard } = bound();
      client.emit("shell_config", configOf(DESK));

      client.emit("shortcut", meta(ENTER));

      expect(heard).toContainEqual(["command", ["terminal"]]);
    });
  });

  describe("modes", () => {
    it("enters the mode a binding names, tells the shell and reads the keys in it", () => {
      const { client, heard } = bound();
      client.emit("shell_config", configOf(DESK));

      client.emit("shortcut", meta(R));
      pressing("Enter");
      pressing("Escape");
      pressing("Enter");

      expect(heard.slice(1)).toStrictEqual([
        ["mode", "resize"],
        ["command", ["resize", "grow", "right"]],
        ["mode", "default"],
        ["command", ["terminal"]],
      ]);
    });

    it("reads the keys in a mode the shell sets, without telling it back", () => {
      // Another page of the desk entered it: the shell knows already.
      const { client, heard, setMode } = bound();
      client.emit("shell_config", configOf(DESK));

      setMode("resize");
      pressing("Enter");

      expect(heard.slice(1)).toStrictEqual([
        ["command", ["resize", "grow", "right"]],
      ]);
    });

    it("does nothing for the mode the keys are already in", () => {
      const { client, heard, setMode } = bound();
      client.emit("shell_config", configOf(DESK));
      pressing("KeyR");

      setMode("resize");

      expect(heard.filter(([kind]) => kind === "mode")).toStrictEqual([
        ["mode", "resize"],
      ]);
    });

    it("goes back to the default mode for one the config does not have", () => {
      // The same answer as a config that drops the mode the keys are in.
      const { client, heard, setMode } = bound();
      client.emit("shell_config", configOf(DESK));
      pressing("KeyR");

      setMode("move");
      pressing("Enter");

      expect(heard.slice(2)).toStrictEqual([
        ["mode", "default"],
        ["command", ["terminal"]],
      ]);
    });

    it("keeps a mode set before any config, until the config says otherwise", () => {
      // A page can be told the desk's mode before its own config arrives.
      const { client, heard, setMode } = bound();

      setMode("resize");
      client.emit("shell_config", configOf(DESK));
      pressing("Enter");

      expect(heard.slice(1)).toStrictEqual([
        ["command", ["resize", "grow", "right"]],
      ]);
    });
  });
});
