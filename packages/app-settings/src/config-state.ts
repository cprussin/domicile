// What the form can do with the desktop's config: edit a writable JSON
// config, or show the settings of one it cannot write and say why.

import type { ConfigDocument } from "./config-document";
import { parseDocument } from "./config-document";
import type { Settings } from "./config-schema";
import { readSettings } from "./config-schema";
import type { HostFile, SettingsFiles } from "./host";

/** A config module, which the builder evaluates to JSON. */
const MODULE = /\.(ts|tsx|js|mjs)$/;

export enum ConfigKind {
  /** The desktop runs the defaults. */
  None,
  /** A JSON config, writable or not. */
  Json,
  /** A config module, shown as the JSON it evaluated to. */
  Module,
  /** A config that does not parse. */
  Unreadable,
}

export const ConfigState = {
  Json: (file: HostFile, document: ConfigDocument, settings: Settings) => ({
    document,
    file,
    kind: ConfigKind.Json as const,
    settings,
  }),
  Module: (path: string, settings: Settings) => ({
    kind: ConfigKind.Module as const,
    path,
    settings,
  }),
  None: (settings: Settings) => ({ kind: ConfigKind.None as const, settings }),
  Unreadable: (path: string, why: string) => ({
    kind: ConfigKind.Unreadable as const,
    path,
    settings: undefined,
    why,
  }),
};

export type ConfigState = ReturnType<
  (typeof ConfigState)[keyof typeof ConfigState]
>;

/** The config `files` hold, read for the form. */
export const configState = (files: SettingsFiles): ConfigState => {
  const { config } = files;
  if (config === undefined) {
    return readSettings({}).match({
      Err: (why) => {
        throw new Error(`The defaults do not fit the schema: ${why}`);
      },
      Ok: ConfigState.None,
    });
  } else if (MODULE.test(config.path)) {
    return moduleState(config.path, files.evaluated);
  } else {
    return parseDocument(config.text)
      .andThen((document) =>
        readSettings(document).map((settings) =>
          ConfigState.Json(config, document, settings),
        ),
      )
      .match<ConfigState>({
        Err: (why) => ConfigState.Unreadable(config.path, why),
        Ok: (state) => state,
      });
  }
};

/** A module config, read from the JSON it evaluated to. */
const moduleState = (
  path: string,
  evaluated: string | undefined,
): ConfigState => {
  if (evaluated === undefined) {
    throw new Error(`The desktop did not evaluate ${path}`);
  } else {
    return parseDocument(evaluated)
      .andThen(readSettings)
      .match<ConfigState>({
        Err: (why) => ConfigState.Unreadable(path, why),
        Ok: (settings) => ConfigState.Module(path, settings),
      });
  }
};

/** Why the form cannot change `state`'s settings, or `undefined` if it can. */
export const whyReadOnly = (state: ConfigState): string | undefined => {
  switch (state.kind) {
    case ConfigKind.None:
      return "This desktop has no config file, so it runs the defaults. Start it with one to change them here.";
    case ConfigKind.Module:
      return `${state.path} is code. Change these settings in it under Code.`;
    case ConfigKind.Unreadable:
      return `${state.path} cannot be read: ${state.why}`;
    case ConfigKind.Json:
      return state.file.writable
        ? undefined
        : `${state.file.path} is read-only. Change it where it is made, such as your home-manager config.`;
  }
};
