// Temporary changes to the desk's config: laid over the config file in the
// compositor until the desktop restarts or the file changes that setting.
// What a shell changes for the user where the config is the user's to keep
// in their own file, such as a switch Nix sets. See
// docs/SETTINGS.md#temporary-changes.
//
// Each request goes out through `changeConfig`, and the compositor answers
// each, in order, with a `configoverrides` event, so the answers are matched
// to the requests by their order. The engine refuses, in their place, those a
// compositor that exited never answered, so a restart keeps them in step.

import { z } from "zod";

import type { DomicileHost } from "../domicile-host";

/** One step down into the config: a key, or an index into a list. */
export type ConfigKey = string | number;

/** Where a setting is in the config, as `["theme", "mode"]`. */
export type ConfigPath = readonly ConfigKey[];

const json = z.string().transform((text): unknown => JSON.parse(text));

const configOverrideSchema = z.object({
  path: z.array(z.union([z.string(), z.number()])),
  value: json,
  written: json,
});

/**
 * A temporary change: `value` in place of `written`, what the config file
 * has at `path`. `null` is the setting's default, or where the file has
 * nothing.
 */
export type ConfigOverride = z.output<typeof configOverrideSchema>;

const answerSchema = z.object({
  overrides: z.array(configOverrideSchema),
  refused: z.string().optional(),
  type: z.literal("config_overrides"),
});

export type ConfigNamespace = {
  /** Every temporary change, in the order they were made. */
  overrides: () => Promise<readonly ConfigOverride[]>;
  /**
   * Lays `value` over the config at `path` until the desktop restarts or the
   * config file changes what it has there; `null` takes the setting to its
   * default. A value the file has there already ends the change. Resolves
   * with every change after it. Rejects with why the compositor refused it,
   * such as a value the config would refuse, which changes nothing.
   */
  setOverride: (
    path: ConfigPath,
    value: unknown,
  ) => Promise<readonly ConfigOverride[]>;
  /** Ends the changes at or under each of `paths`. Resolves with the rest. */
  resetOverrides: (
    paths: readonly ConfigPath[],
  ) => Promise<readonly ConfigOverride[]>;
};

export type ConfigHost = Pick<
  DomicileHost,
  "addEventListener" | "changeConfig" | "removeEventListener"
>;

type Waiting = {
  resolve: (overrides: readonly ConfigOverride[]) => void;
  reject: (why: Error) => void;
};

/**
 * Settles `waiting` with the compositor's answer, `data`. An answer it cannot
 * read rejects the request it answers, then throws, as a broken compositor
 * should be loud; the requests after it still get their own answers.
 */
const answerTo = (waiting: Waiting, data: string) => {
  const answer = z
    .string()
    .transform((text, context): unknown => {
      try {
        return JSON.parse(text);
      } catch {
        context.addIssue({ code: "custom", message: "not JSON" });
        return z.NEVER;
      }
    })
    .pipe(answerSchema)
    .safeParse(data);
  if (!answer.success) {
    const why = new Error(
      `the compositor's answer to a change to the config is unreadable: ${data}`,
    );
    waiting.reject(why);
    throw why;
  } else if (answer.data.refused === undefined) {
    waiting.resolve(answer.data.overrides);
  } else {
    waiting.reject(new Error(answer.data.refused));
  }
};

/** `value` as JSON text; throws for one JSON has no text for, as a function. */
const jsonOf = (value: unknown): string => {
  const text = JSON.stringify(value ?? null) as string | undefined;
  if (text === undefined) {
    throw new TypeError(`${String(value)} has no JSON to set in the config`);
  } else {
    return text;
  }
};

export const config = (host: ConfigHost): ConfigNamespace => {
  const waiting: Waiting[] = [];
  let listening = false;
  const listen = () => {
    if (!listening) {
      listening = true;
      host.addEventListener("configoverrides", (event) => {
        const next = waiting.shift();
        if (next === undefined) {
          throw new Error(
            "the compositor answered a change to the config nobody asked for",
          );
        } else {
          answerTo(next, event.data);
        }
      });
    }
  };
  /** Sends what `request` makes; it rejects with what it throws. */
  const ask = (request: () => object) => {
    listen();
    return new Promise<readonly ConfigOverride[]>((resolve, reject) => {
      // Sent first, so a request the host refuses, or one never sent, leaves
      // no waiter to take the next answer.
      host.changeConfig(JSON.stringify(request()));
      waiting.push({ reject, resolve });
    });
  };
  return {
    overrides: () => ask(() => ({ type: "which_config_overrides" })),
    resetOverrides: (paths) =>
      ask(() => ({
        paths: paths.map(onTheWire),
        type: "reset_config_overrides",
      })),
    setOverride: (path, value) =>
      ask(() => ({
        path: onTheWire(path),
        type: "set_config_override",
        value: jsonOf(value),
      })),
  };
};

/** The highest index the engine passes on as a whole number. */
const MAX_INDEX = 0x7f_ff_ff_ff;

/**
 * `path` as the compositor reads it. Throws for an index that is not a whole
 * number from 0 to {@link MAX_INDEX}, which the compositor would drop
 * unanswered, putting every later answer out of step with its request.
 */
const onTheWire = (path: ConfigPath): ConfigKey[] =>
  path.map((key) => {
    if (
      typeof key === "number" &&
      !(Number.isInteger(key) && key >= 0 && key <= MAX_INDEX)
    ) {
      throw new RangeError(
        `${String(key)} is no list index in config path ${JSON.stringify(path)}`,
      );
    } else {
      return key;
    }
  });

/** Where the config lists the extensions browser profile `profile` turns on. */
export const profileExtensionsPath = (profile: string): ConfigPath => [
  "browser",
  "profiles",
  profile,
  "extensions",
];

const samePath = (a: ConfigPath, b: ConfigPath) =>
  a.length === b.length && a.every((key, at) => key === b[at]);

/** The change at `path`, if there is one. */
export const overrideAt = (
  overrides: readonly ConfigOverride[],
  path: ConfigPath,
): ConfigOverride | undefined =>
  overrides.find((change) => samePath(change.path, path));

/** A config list of extension ids; none for anything else. */
export const idsOf = (value: unknown): readonly string[] =>
  Array.isArray(value)
    ? value.filter((id): id is string => typeof id === "string")
    : [];

/**
 * The extensions a temporary change switches in browser profile `profile`
 * apart from its config: each on in one of the change and the file, and off
 * in the other. Sorted.
 */
export const changedExtensions = (
  overrides: readonly ConfigOverride[],
  profile: string,
): readonly string[] => {
  const change = overrideAt(overrides, profileExtensionsPath(profile));
  if (change === undefined) {
    return [];
  } else {
    const now = idsOf(change.value);
    const written = idsOf(change.written);
    return [...new Set([...now, ...written])]
      .filter((id) => now.includes(id) !== written.includes(id))
      .toSorted();
  }
};

/**
 * `list`, a profile's config list of extensions, with `id` on or off: the
 * file's own list, `written`, when it comes to the same extensions, so a
 * temporary change of it ends.
 */
export const switchedExtensions = (
  list: readonly string[],
  id: string,
  on: boolean,
  written: readonly string[],
): readonly string[] => {
  const next = on
    ? [...new Set([...list, id])]
    : list.filter((each) => each !== id);
  const same =
    next.length === written.length &&
    next.every((each) => written.includes(each));
  return same ? written : next;
};

/** A browser profile, as far as its config-switched extensions go. */
export type ProfileSwitches = {
  readonly id: string;
  /** Those of its extensions on now. */
  readonly enabledExtensions: readonly string[];
  /** Those its config list switches, which only the config changes. */
  readonly lockedExtensions: readonly string[];
};

/**
 * Switches extension `id`, one `profile`'s config list switches, on or off
 * there until the desktop restarts or the config changes that list: a
 * temporary change to the list. Resolves with every change after it.
 *
 * Only an earlier change of the list says what the file has, so the first
 * guesses the file's list from the switches, then lays the switch over the
 * file's own once the answer says it, which keeps any id the file lists that
 * the profile does not have.
 */
const switchNow = async (
  config: ConfigNamespace,
  profile: ProfileSwitches,
  id: string,
  on: boolean,
): Promise<readonly ConfigOverride[]> => {
  const path = profileExtensionsPath(profile.id);
  /** The switch laid over the file's own list, which `answered` says. */
  const overTheFile = (answered: readonly ConfigOverride[]) => {
    const change = overrideAt(answered, path);
    if (change === undefined) {
      return answered;
    } else {
      // With no change before it, the list was the file's.
      const written = idsOf(change.written);
      const meant = switchedExtensions(written, id, on, written);
      const sent = idsOf(change.value);
      return meant.length === sent.length &&
        meant.every((each, at) => each === sent[at])
        ? answered
        : config.setOverride(path, meant);
    }
  };
  const before = overrideAt(await config.overrides(), path);
  if (before === undefined) {
    const guess = profile.lockedExtensions.filter((each) =>
      profile.enabledExtensions.includes(each),
    );
    return overTheFile(
      await config.setOverride(path, switchedExtensions(guess, id, on, [])),
    );
  } else {
    return config.setOverride(
      path,
      switchedExtensions(idsOf(before.value), id, on, idsOf(before.written)),
    );
  }
};

/**
 * Puts extension `id` in `profile` back as the config file switches it,
 * keeping the list's other temporary switches. Resolves with every change
 * after it.
 */
const resetNow = async (
  config: ConfigNamespace,
  profile: string,
  id: string,
): Promise<readonly ConfigOverride[]> => {
  const path = profileExtensionsPath(profile);
  const listed = await config.overrides();
  const change = overrideAt(listed, path);
  if (change === undefined) {
    return listed;
  } else {
    const written = idsOf(change.written);
    return config.setOverride(
      path,
      switchedExtensions(
        idsOf(change.value),
        id,
        written.includes(id),
        written,
      ),
    );
  }
};

/** Each config's switch or reset under way, for the next to wait on. */
const turns = new WeakMap<ConfigNamespace, Promise<unknown>>();

/**
 * Runs `change` once `config`'s changes before it have answered, so each
 * reads the list the last left: two quick switches both stay.
 */
const inTurn = <T>(
  config: ConfigNamespace,
  change: () => Promise<T>,
): Promise<T> => {
  const next = (turns.get(config) ?? Promise.resolve()).then(change, change);
  turns.set(
    config,
    next.catch(() => undefined),
  );
  return next;
};

/** {@link switchNow}, after the switches and resets before it. */
export const switchInConfig = (
  config: ConfigNamespace,
  profile: ProfileSwitches,
  id: string,
  on: boolean,
): Promise<readonly ConfigOverride[]> =>
  inTurn(config, () => switchNow(config, profile, id, on));

/** {@link resetNow}, after the switches and resets before it. */
export const resetInConfig = (
  config: ConfigNamespace,
  profile: string,
  id: string,
): Promise<readonly ConfigOverride[]> =>
  inTurn(config, () => resetNow(config, profile, id));
