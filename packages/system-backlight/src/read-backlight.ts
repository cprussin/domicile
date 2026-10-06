// Reads the screen's backlight from `/sys/class/backlight`.

import type { Option, Result } from "@cprussin/option-result";
import { Err, None, Ok, Some } from "@cprussin/option-result";
import type { System, SystemError } from "@domicile-desktop/sdk/system";
import { SystemErrorKind } from "@domicile-desktop/sdk/system";
import { z } from "zod";

/** Sysfs directory listing every backlight. */
const BACKLIGHT = "/sys/class/backlight";

/**
 * Backlight types, preferred first, in systemd's order. A firmware interface
 * knows the panel's curve; a raw one drives the same panel without it.
 */
const KINDS = ["firmware", "platform", "raw"] as const;

/** The files read from each device, in the order `readOne` takes them. */
const FILES = ["type", "max_brightness", "brightness"];

/** The calls {@link readBacklight} makes. */
export type SysfsHost = Pick<System, "readDir" | "readTextFile">;

/** One backlight device's current and maximum raw brightness. */
export type Backlight = {
  /** The name under `/sys/class/backlight`, which logind takes. */
  device: string;
  raw: number;
  max: number;
};

/**
 * The backlight to show and set, or `None` if there is none.
 *
 * Picks the preferred type, breaking ties by name so the choice is stable.
 * Skips a device whose files are missing or not numbers, or whose maximum is
 * zero.
 */
export const readBacklight = async (
  host: SysfsHost,
): Promise<Result<Option<Backlight>, SystemError>> =>
  (await host.readDir(BACKLIGHT)).match({
    Err: async (error) =>
      error.kind === SystemErrorKind.NotFound ? Ok(None()) : Err(error),
    Ok: async (entries) =>
      collected(
        await Promise.all(
          entries
            .map(({ name }) => name)
            .toSorted()
            .map((device) => readOne(host, device)),
        ),
      ).map((devices) =>
        firstSome(
          KINDS.map((kind) =>
            firstSome(
              devices.map((device) =>
                device.andThen((read) =>
                  read.kind === kind ? Some(read.backlight) : None(),
                ),
              ),
            ),
          ),
        ),
      ),
  });

/** Brightness from 0 to 1. */
export const levelOf = ({ max, raw }: Backlight): number => raw / max;

type Read = { kind: (typeof KINDS)[number]; backlight: Backlight };

const readOne = async (
  host: SysfsHost,
  device: string,
): Promise<Result<Option<Read>, SystemError>> =>
  collected(
    await Promise.all(FILES.map((file) => readFile(host, device, file))),
  ).map(([kind, max, raw]) => {
    const parsed = deviceSchema.safeParse({
      kind: present(kind),
      max: present(max),
      raw: present(raw),
    });
    return parsed.success
      ? Some({
          backlight: {
            device,
            max: parsed.data.max,
            raw: Math.min(parsed.data.raw, parsed.data.max),
          },
          kind: parsed.data.kind,
        })
      : None();
  });

/** A file of `device`, trimmed, or `None` if it is missing. */
const readFile = async (
  host: SysfsHost,
  device: string,
  file: string,
): Promise<Result<Option<string>, SystemError>> =>
  (await host.readTextFile(`${BACKLIGHT}/${device}/${file}`)).match({
    Err: (error) =>
      error.kind === SystemErrorKind.NotFound ? Ok(None()) : Err(error),
    Ok: (text) => Ok(Some(text.trim())),
  });

const count = z
  .string()
  .regex(/^\d+$/)
  .transform((digits) => Number.parseInt(digits, 10));

const deviceSchema = z.object({
  kind: z.enum(KINDS),
  max: count.refine((max) => max > 0),
  raw: count,
});

/** Every value, or the first error. */
const collected = <T extends NonNullable<unknown>>(
  results: readonly Result<T, SystemError>[],
): Result<T[], SystemError> =>
  results.reduce<Result<T[], SystemError>>(
    (all, next) =>
      all.andThen((values) => next.map((value) => [...values, value])),
    Ok([]),
  );

const present = (text: Option<string> | undefined): string | undefined =>
  text?.match({ None: () => undefined, Some: (value) => value });

const firstSome = <T extends NonNullable<unknown>>(
  options: readonly Option<T>[],
): Option<T> => options.reduce((found, next) => found.or(next), None<T>());
