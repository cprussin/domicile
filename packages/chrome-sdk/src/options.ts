// The options a shell declares, their JSON form and the values a config gives
// them. The shell exports the declaration as `options`; the builder writes it
// to `options.json`, the Settings app draws a form from it, and the config's
// `shell_options` holds the values. See `docs/architecture/SHELL-OPTIONS.md`.

import { z } from "zod";

import type { ShellNamespace } from "./desktop/shell";

const label = z.string().min(1);

const toggleSchema = z.strictObject({
  default: z.boolean(),
  kind: z.literal("toggle"),
  label,
});

const choiceSchema = z
  .strictObject({
    choices: z.array(z.string()).min(1),
    default: z.string(),
    kind: z.literal("choice"),
    label,
  })
  .refine((choice) => choice.choices.includes(choice.default), {
    message: "the default is not one of the choices",
  });

const numberSchema = z
  .strictObject({
    default: z.number(),
    kind: z.literal("number"),
    label,
    max: z.number().optional(),
    min: z.number().optional(),
  })
  .refine((number) => numberProblem(number, number.default) === undefined, {
    message: "the default is outside the limits",
  });

const textSchema = z.strictObject({
  default: z.string(),
  kind: z.literal("text"),
  label,
});

const listSchema = z.strictObject({
  default: z.array(z.string()),
  kind: z.literal("list"),
  label,
});

const optionSchema = z.union([
  toggleSchema,
  choiceSchema,
  numberSchema,
  textSchema,
  listSchema,
]);

/** A switch. Its value is `true` or `false`. */
export type ToggleOption = z.infer<typeof toggleSchema>;

/** One of a list of words. */
export type ChoiceOption<C extends string = string> = Omit<
  z.infer<typeof choiceSchema>,
  "choices" | "default"
> & { readonly choices: readonly C[]; readonly default: C };

/** A number, within `min` and `max` when they are given. */
export type NumberOption = z.infer<typeof numberSchema>;

/** A line of text. */
export type TextOption = z.infer<typeof textSchema>;

/** A list of lines of text. */
export type ListOption = Omit<z.infer<typeof listSchema>, "default"> & {
  readonly default: readonly string[];
};

/** One option a shell reads. */
export type Option =
  | ToggleOption
  | ChoiceOption
  | NumberOption
  | TextOption
  | ListOption;

/** Options under one key, as `clock: { format, seconds }`. */
export type GroupOption<T extends Options = Options> = {
  readonly kind: "group";
  readonly options: T;
};

/** A shell's declared options, by key: what `options.json` holds. */
export type Options = { readonly [key: string]: Option | GroupOption };

/** What `defineOptions` takes: options, and plain objects of them as groups. */
export type OptionsInput = { readonly [key: string]: Option | OptionsInput };

/** The declaration `defineOptions` makes of `T`. */
export type Declared<T extends OptionsInput> = {
  readonly [K in keyof T]: T[K] extends Option
    ? T[K]
    : T[K] extends OptionsInput
      ? GroupOption<Declared<T[K]>>
      : never;
};

/** The value each option in `T` has. */
export type OptionValues<T extends Options> = {
  readonly [K in keyof T]: OptionValue<T[K]>;
};

/** The value an option, or a group of them, has. */
export type OptionValue<E> =
  E extends GroupOption<infer G>
    ? OptionValues<G>
    : E extends ToggleOption
      ? boolean
      : E extends ChoiceOption<infer C>
        ? C
        : E extends NumberOption
          ? number
          : E extends TextOption
            ? string
            : E extends ListOption
              ? readonly string[]
              : never;

/** The values a config gives, and why any it gave were dropped. */
export type ReadOptions<T extends Options> = {
  readonly values: OptionValues<T>;
  /** One line per value dropped: where it is, and what is wrong with it. */
  readonly dropped: readonly string[];
};

const groupSchema: z.ZodType<GroupOption> = z.strictObject({
  kind: z.literal("group"),
  options: z.lazy(() => optionsSchema),
});

/** `options.json`: a shell's declared options, by key. */
export const optionsSchema: z.ZodType<Options> = z.record(
  z.string(),
  z.union([optionSchema, groupSchema]),
);

/** The option kinds, each with a label and a default. */
export const option = {
  choice: <const C extends string>(
    label: string,
    choices: readonly C[],
    defaultChoice: C,
  ): ChoiceOption<C> => ({
    choices,
    default: defaultChoice,
    kind: "choice",
    label,
  }),
  list: (label: string, defaultList: readonly string[]): ListOption => ({
    default: defaultList,
    kind: "list",
    label,
  }),
  number: (
    label: string,
    defaultNumber: number,
    limits: { readonly min?: number; readonly max?: number } = {},
  ): NumberOption => ({
    default: defaultNumber,
    kind: "number",
    label,
    ...limits,
  }),
  text: (label: string, defaultText: string): TextOption => ({
    default: defaultText,
    kind: "text",
    label,
  }),
  toggle: (label: string, defaultValue: boolean): ToggleOption => ({
    default: defaultValue,
    kind: "toggle",
    label,
  }),
};

/**
 * A shell's options, for its `options` export. A plain object of options is a
 * group. Throws on a default its own choices or limits refuse.
 */
export const defineOptions = <const T extends OptionsInput>(
  input: T,
): Declared<T> => {
  const declared = declare(input);
  optionsSchema.parse(declared);
  return declared;
};

/**
 * The value of every option in `declared`: the config's where it gives a good
 * one, the default elsewhere.
 */
export const readOptions = <T extends Options>(
  declared: T,
  given: Readonly<Record<string, unknown>> | undefined,
): ReadOptions<T> => {
  const { dropped, values } = readGroup(declared, given ?? {}, "");
  return {
    dropped,
    // The values follow `declared` key by key, which the type cannot see.
    values: values as OptionValues<T>,
  };
};

/**
 * The value `given` sets for `option`, or its default where it sets none or
 * one `option` refuses.
 */
export const readOption = <O extends Option>(
  option: O,
  given: unknown,
): OptionValue<O> =>
  // Checked against `option` just here, which the type cannot see.
  (given !== undefined && optionProblem(option, given) === undefined
    ? given
    : option.default) as OptionValue<O>;

/** What is wrong with `value` for `option`, or `undefined` if nothing is. */
export const optionProblem = (
  option: Option,
  value: unknown,
): string | undefined => {
  switch (option.kind) {
    case "toggle":
      return typeof value === "boolean" ? undefined : "is not true or false";
    case "choice":
      return typeof value === "string" && option.choices.includes(value)
        ? undefined
        : `is not one of ${option.choices.join(", ")}`;
    case "number":
      return typeof value === "number" && Number.isFinite(value)
        ? numberProblem(option, value)
        : "is not a number";
    case "text":
      return typeof value === "string" ? undefined : "is not text";
    case "list":
      return Array.isArray(value) &&
        value.every((item) => typeof item === "string")
        ? undefined
        : "is not a list of text";
  }
};

/** What `watchShellOptions` needs of the desktop. */
export type ShellOptionsDesktop = {
  readonly shell: Pick<ShellNamespace, "on" | "options">;
};

/**
 * Call `listener` with the values of `declared` now and each time the config
 * changes them. Returns a function that stops listening.
 *
 * A value the config gives that `declared` refuses is dropped, takes its
 * default and is passed to `report`, so the shell starts whatever the config
 * says.
 */
export const watchShellOptions = <T extends Options>(
  { shell }: ShellOptionsDesktop,
  declared: T,
  listener: (values: OptionValues<T>) => void,
  report: (dropped: string) => void = reportToConsole,
): (() => void) => {
  const heard = () => {
    const { dropped, values } = readOptions(declared, shell.options);
    for (const line of dropped) {
      report(line);
    }
    listener(values);
  };
  const stop = shell.on("optionschange", heard);
  heard();
  return stop;
};

/** `input` with each plain object made a group. */
const declare = <T extends OptionsInput>(input: T): Declared<T> =>
  Object.fromEntries(
    Object.entries(input).map(([key, entry]) => [
      key,
      isOption(entry) ? entry : { kind: "group", options: declare(entry) },
    ]),
  ) as Declared<T>;

const isOption = (entry: Option | OptionsInput): entry is Option =>
  typeof entry.kind === "string";

type Read = { values: Record<string, unknown>; dropped: string[] };

const readGroup = (
  declared: Options,
  given: Readonly<Record<string, unknown>>,
  at: string,
): Read => {
  const unknown = Object.keys(given)
    .filter((key) => !Object.hasOwn(declared, key))
    .map((key) => `${at}${key}: no such option`);
  const read = Object.entries(declared).map(([key, entry]) => ({
    key,
    ...readEntry(entry, given[key], `${at}${key}`),
  }));
  return {
    dropped: [...read.flatMap(({ dropped }) => dropped), ...unknown].toSorted(),
    values: Object.fromEntries(read.map(({ key, value }) => [key, value])),
  };
};

const readEntry = (
  entry: Option | GroupOption,
  given: unknown,
  at: string,
): { value: unknown; dropped: string[] } => {
  if (entry.kind === "group") {
    const group = recordSchema.safeParse(given === undefined ? {} : given);
    if (group.success) {
      const { dropped, values } = readGroup(
        entry.options,
        group.data,
        `${at}.`,
      );
      return { dropped, value: values };
    } else {
      return {
        dropped: [`${at}: ${JSON.stringify(given)} is not a group of options`],
        value: readGroup(entry.options, {}, "").values,
      };
    }
  } else if (given === undefined) {
    return { dropped: [], value: entry.default };
  } else {
    const problem = optionProblem(entry, given);
    return problem === undefined
      ? { dropped: [], value: given }
      : {
          dropped: [`${at}: ${JSON.stringify(given)} ${problem}`],
          value: entry.default,
        };
  }
};

const recordSchema = z.record(z.string(), z.unknown());

const reportToConsole = (dropped: string): void => {
  // biome-ignore lint/suspicious/noConsole: the option takes its default, and the config's author should learn why
  console.error(`shell_options.${dropped}`);
};

/** Which of `limits` `value` is outside, or `undefined` if neither. */
const numberProblem = (
  limits: {
    readonly min?: number | undefined;
    readonly max?: number | undefined;
  },
  value: number,
): string | undefined => {
  if (limits.min !== undefined && value < limits.min) {
    return `is below ${String(limits.min)}`;
  } else if (limits.max !== undefined && value > limits.max) {
    return `is above ${String(limits.max)}`;
  } else {
    return undefined;
  }
};
