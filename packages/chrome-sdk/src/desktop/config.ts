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
