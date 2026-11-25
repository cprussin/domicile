// Browser extensions: those with an action, which a shell's tray draws, and
// every installed one, which a shell's menu switches and configures. See
// docs/architecture/EXTENSIONS.md.

import { z } from "zod";

import type { AppMenuEntry } from "../app-menu";
import { appMenu } from "../app-menu";
import type {
  DomicileExtension,
  DomicileHost,
  DomicileInstalledExtension,
} from "../domicile-host";
import type {
  Extension,
  ExtensionCommands,
  ExtensionPopup,
  ExtensionSettings,
  InstalledExtension,
  PressedCommand,
} from "../extension";
import {
  extensionCommandsSchema,
  extensionPopupSchema,
  extensionSchema,
  installedExtensionSchema,
  pressedCommandSchema,
} from "../extension";
import { memoizeLast } from "./memoize-last";
import type { On } from "./subscribe";
import { hostEvent, on } from "./subscribe";

export type ExtensionsListeners = {
  change: () => void;
  /**
   * The keys of an extension's command were pressed in a page. The engine runs
   * the command on that page, unless the shell listens: the shell then does,
   * with `runCommand`.
   */
  commandPressed: (command: PressedCommand) => void;
  /** `commands` changed. */
  commands: () => void;
  /** `installed` changed. */
  installed: () => void;
  /**
   * An extension called `action.openPopup()`. Open `popup` as a clicked
   * action's popup. Parsed: throws on a request a shell cannot open.
   */
  popup: (request: ExtensionPopup) => void;
};

export type Extensions = {
  /**
   * `undefined` until the engine says. Parsed, since the engine and the SDK
   * ship apart: throws on an action a shell cannot draw.
   */
  readonly list: readonly Extension[] | undefined;
  /**
   * Every installed extension, switched on or off. `undefined` until the
   * engine says. Parsed: throws on a row a shell cannot draw.
   */
  readonly installed: readonly InstalledExtension[] | undefined;
  /**
   * Every extension with commands (`chrome.commands`), with an action or
   * without, and the keys bound to each. Those of the profile `setProfile`
   * named. `undefined` until the engine says. Parsed: throws on one a shell
   * cannot run.
   */
  readonly commands: readonly ExtensionCommands[] | undefined;
  /** Click extension `id`'s action. One with a popup is the shell's to open. */
  activate: (id: string) => void;
  /**
   * Changes `settings` on extension `id`. Rejects with an `OperationError`
   * for a setting the desk's config sets, or an extension not installed.
   */
  configure: (id: string, settings: ExtensionSettings) => Promise<void>;
  /**
   * The items extension `id` adds to its action's menu, matched now. Throws on
   * a menu a shell cannot draw.
   */
  menu: (id: string) => Promise<readonly AppMenuEntry[]>;
  on: On<ExtensionsListeners>;
  /**
   * Keeps `keys`, each as `Ctrl+T`, from extensions, in place of those given
   * before. A command bound to one has no keys, and the page gets them, then
   * the shell. None are kept by default.
   */
  reserveKeys: (keys: readonly string[]) => void;
  /**
   * Runs command `name` of extension `id` on the active page, as its keys do
   * in Chrome. The action's own, `_execute_action`, runs the action, and is a
   * `popup` event when the action has a popup.
   */
  runCommand: (id: string, name: string) => void;
  /** Runs entry `item` of the newest `menu` on the active page. */
  runMenuItem: (item: number) => void;
  /** Switches extension `id` on or off. Rejects for one not installed. */
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
  /**
   * Shows browser profile `profile`'s extensions in `list`, and has
   * `activate` click them there, on its active page: as a browser's toolbar
   * shows its window's profile's. Name the profile of the page last focused.
   * The default profile's until called, and while `profile` loads.
   */
  setProfile: (profile: string) => void;
  /**
   * Uninstalls extension `id`. Rejects for one the desk's config installed,
   * which comes back on the next start.
   */
  uninstall: (id: string) => Promise<void>;
};

export type ExtensionsHost = Pick<
  DomicileHost,
  | "activateExtension"
  | "addEventListener"
  | "configureExtension"
  | "extensionCommands"
  | "extensionMenu"
  | "extensions"
  | "installedExtensions"
  | "removeEventListener"
  | "reserveExtensionKeys"
  | "runExtensionCommand"
  | "runExtensionMenuItem"
  | "setExtensionEnabled"
  | "setExtensionsProfile"
  | "uninstallExtension"
>;

export const extensions = (host: ExtensionsHost): Extensions => {
  const listOf = memoizeLast((list: readonly DomicileExtension[] | null) =>
    list === null ? undefined : z.array(extensionSchema).parse(list),
  );
  const commandsOf = memoizeLast((commands: string | null) =>
    commands === null
      ? undefined
      : z.array(extensionCommandsSchema).parse(JSON.parse(commands)),
  );
  const installedOf = memoizeLast(
    (list: readonly DomicileInstalledExtension[] | null) =>
      list === null ? undefined : z.array(installedExtensionSchema).parse(list),
  );
  return {
    activate: (id) => {
      host.activateExtension(id);
    },
    get commands() {
      return commandsOf(host.extensionCommands);
    },
    configure: (id, settings) => host.configureExtension(id, settings),
    get installed() {
      return installedOf(host.installedExtensions);
    },
    get list() {
      return listOf(host.extensions);
    },
    menu: async (id) => appMenu(await host.extensionMenu(id)),
    on: on<ExtensionsListeners>({
      change: (listener) =>
        hostEvent(host, "extensionschanged", () => listener()),
      commandPressed: (listener) =>
        hostEvent(host, "extensioncommandpressed", (event) =>
          listener(pressedCommandSchema.parse(JSON.parse(event.data))),
        ),
      commands: (listener) =>
        hostEvent(host, "extensioncommandschanged", () => listener()),
      installed: (listener) =>
        hostEvent(host, "installedextensionschanged", () => listener()),
      popup: (listener) =>
        hostEvent(
          host,
          "extensionpopuprequested",
          ({ extensionId, popup, profile }) =>
            listener(
              extensionPopupSchema.parse({ id: extensionId, popup, profile }),
            ),
        ),
    }),
    reserveKeys: (keys) => {
      host.reserveExtensionKeys([...keys]);
    },
    runCommand: (id, name) => {
      host.runExtensionCommand(id, name);
    },
    runMenuItem: (item) => {
      host.runExtensionMenuItem(item);
    },
    setEnabled: (id, enabled) => host.setExtensionEnabled(id, enabled),
    setProfile: (profile) => {
      host.setExtensionsProfile(profile);
    },
    uninstall: (id) => host.uninstallExtension(id),
  };
};
