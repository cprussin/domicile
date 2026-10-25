import { Button } from "@domicile-desktop/component-library/Button";
import { Card } from "@domicile-desktop/component-library/Card";
import { ArrowUpIcon } from "@phosphor-icons/react/dist/ssr/ArrowUp";
import { KeyboardIcon } from "@phosphor-icons/react/dist/ssr/Keyboard";
import { TrashIcon } from "@phosphor-icons/react/dist/ssr/Trash";
import { useId } from "react";
import { z } from "zod";

import { css, cva } from "../../styled-system/css";
import { flex } from "../../styled-system/patterns";
import { AddRow } from "../AddRow";
import type { ConfigDocument, ConfigPath } from "../config-document";
import { valueAt } from "../config-document";
import type { ConfigEditor, ConfigPageProps } from "../config-editor";
import type { Keymap, Settings } from "../config-schema";
import { ListSetting } from "../ListSetting";
import { Page } from "../Page";
import { SettingRow } from "../SettingRow";
import { TextSetting } from "../TextSetting";

/** xkb's fields other than the options, with their defaults. */
const FIELDS = [
  {
    fallback: "us",
    hint: "Such as us, de or us,ru.",
    key: "xkb_layout",
    title: "Layout",
  },
  {
    fallback: "",
    hint: "Such as dvp or colemak. Empty is the layout's own.",
    key: "xkb_variant",
    title: "Variant",
  },
  {
    fallback: "",
    hint: "The keyboard's model, such as pc105. Empty is xkb's default.",
    key: "xkb_model",
    title: "Model",
  },
  {
    fallback: "",
    hint: "The rules file. Empty is xkb's default.",
    key: "xkb_rules",
    title: "Rules",
  },
] as const;

/** How xkb compiles one keymap, as the page shows it. */
type Xkb = Omit<Keymap, "name">;

/**
 * `input.keyboard`: the xkb layout, or the keymaps the desktop switches
 * between.
 */
export const KeyboardPage = ({
  description,
  editor,
  title,
}: ConfigPageProps) => {
  const { readOnly, report, set, settings } = editor;
  const { keyboard } = settings.input;
  const { keymaps } = keyboard;
  const disabled = readOnly !== undefined;
  return (
    <Page description={description} readOnly={readOnly} title={title}>
      {keymaps.length === 0 ? (
        <>
          <Card>
            <XkbRows
              editor={editor}
              labelOf={(field) => field}
              path={["input", "keyboard"]}
              xkb={keyboard}
            />
          </Card>
          <Card title="Options">
            <OptionList
              addLabel="Add an option"
              editor={editor}
              path={["input", "keyboard"]}
              xkb={keyboard}
            />
          </Card>
        </>
      ) : (
        keymaps.map((keymap, index) => (
          <KeymapCard
            editor={editor}
            index={index}
            key={`${index}-${keymap.name}`}
            keymap={keymap}
          />
        ))
      )}
      {!disabled && (
        <Card title="New keymap">
          <p className={hintStyles}>
            The desktop switches between keymaps with the `keymap` command or
            the bar's keymap item. The first is the one it starts on.
          </p>
          <AddRow
            button="Add keymap"
            label="New keymap name"
            onAdd={(name) => {
              const why = refusedName(name, keymapNames(settings));
              if (why !== undefined) {
                report("Not a keymap name")(why);
              } else if (keymaps.length === 0) {
                // The keyboard becomes the first keymap, so it stays the one
                // the desktop starts on.
                set(["input", "keyboard"], {
                  keymaps: [
                    {
                      name: keymapNames(settings)[0],
                      ...writtenAt(editor.document, ["input", "keyboard"]),
                    },
                    { name },
                  ],
                });
              } else {
                set(["input", "keyboard", "keymaps", keymaps.length], { name });
              }
            }}
            placeholder="us"
          />
        </Card>
      )}
    </Page>
  );
};

type KeymapCardProps = {
  editor: ConfigEditor;
  index: number;
  keymap: Keymap;
};

/**
 * A keymap: its name, its xkb fields, and buttons to move or remove it. The
 * first is marked as the one the desktop starts on.
 */
const KeymapCard = ({ editor, index, keymap }: KeymapCardProps) => {
  const { document, readOnly, report, set, settings } = editor;
  const disabled = readOnly !== undefined;
  const path = ["input", "keyboard", "keymaps", index] as const;
  const written = writtenKeymaps(document);
  const first = index === 0;
  const headingId = useId();
  return (
    <Card aria-labelledby={headingId}>
      <div className={headerStyles}>
        <KeyboardIcon
          aria-hidden
          className={keyboardStyles({ first })}
          size={20}
          weight="duotone"
        />
        <h2 className={nameStyles} id={headingId}>
          {keymap.name}
        </h2>
        {first && <span className={startsStyles}>Starts here</span>}
        {!disabled && !first && (
          <Button
            beforeIcon={<ArrowUpIcon size={14} />}
            onClick={() => {
              set(["input", "keyboard", "keymaps"], movedUp(written, index));
            }}
            size="sm"
            variant="ghost"
          >
            {`Move ${keymap.name} up`}
          </Button>
        )}
        {!disabled && (
          <Button
            beforeIcon={<TrashIcon size={14} />}
            onClick={() => {
              const [only, ...more] = written.filter((_, at) => at !== index);
              if (only !== undefined && more.length === 0) {
                // One keymap is the plain keyboard: nothing to switch to.
                set(
                  ["input", "keyboard"],
                  Object.fromEntries(
                    Object.entries(only).filter(([key]) => key !== "name"),
                  ),
                );
              } else {
                set(path, undefined);
              }
            }}
            size="sm"
            variant="ghost"
          >
            {`Remove ${keymap.name}`}
          </Button>
        )}
      </div>
      <div>
        <SettingRow hint="What the `keymap` command calls it." title="Name">
          <TextSetting
            disabled={disabled}
            label={`${keymap.name} name`}
            onCommit={(text) => {
              const name = text.trim();
              const why = refusedName(
                name,
                keymapNames(settings).filter((_, at) => at !== index),
              );
              if (why === undefined) {
                set([...path, "name"], name);
                return true;
              } else {
                report("Not a keymap name")(why);
                return false;
              }
            }}
            value={keymap.name}
          />
        </SettingRow>
        <XkbRows
          editor={editor}
          labelOf={(field) => `${keymap.name} ${field.toLowerCase()}`}
          path={path}
          xkb={keymap}
        />
        <SettingRow title="Options">
          <OptionList
            addLabel={`Add an option to ${keymap.name}`}
            editor={editor}
            path={path}
            xkb={keymap}
          />
        </SettingRow>
      </div>
    </Card>
  );
};

type XkbProps = {
  editor: ConfigEditor;
  /** Where the fields are in the config. */
  path: ConfigPath;
  xkb: Xkb;
};

/** The xkb fields other than the options, one row each. */
const XkbRows = ({
  editor,
  labelOf,
  path,
  xkb,
}: XkbProps & {
  /** Names a field's control, from the field's title. */
  labelOf: (field: string) => string;
}) => {
  const { readOnly, report, set } = editor;
  return FIELDS.map((field) => (
    <SettingRow hint={field.hint} key={field.key} title={field.title}>
      <TextSetting
        disabled={readOnly !== undefined}
        label={labelOf(field.title)}
        onCommit={(text) => {
          const value = text.trim();
          if (field.key === "xkb_layout" && value === "") {
            report("A layout is needed")("xkb has no layout to fall back on");
            return false;
          } else {
            set(
              [...path, field.key],
              value === field.fallback ? undefined : value,
            );
            return true;
          }
        }}
        placeholder={field.fallback}
        value={xkb[field.key]}
      />
    </SettingRow>
  ));
};

/** The xkb options, such as `caps:escape`. */
const OptionList = ({
  addLabel,
  editor,
  path,
  xkb,
}: XkbProps & { addLabel: string }) => (
  <ListSetting
    addButton="Add option"
    addLabel={addLabel}
    disabled={editor.readOnly !== undefined}
    items={xkb.xkb_options}
    onChange={(options) => {
      editor.set(
        [...path, "xkb_options"],
        options.length === 0 ? undefined : options,
      );
    }}
    placeholder="caps:escape"
  />
);

/**
 * The keymaps' names. A keyboard with no `keymaps` is one keymap, named for
 * its variant or else its layout, as the compositor names it.
 */
const keymapNames = ({ input: { keyboard } }: Settings): string[] =>
  keyboard.keymaps.length === 0
    ? [keyboard.xkb_variant === "" ? keyboard.xkb_layout : keyboard.xkb_variant]
    : keyboard.keymaps.map(({ name }) => name);

/** Why the compositor would refuse `name` beside `others`, if it would. */
const refusedName = (
  name: string,
  others: readonly string[],
): string | undefined => {
  if (name === "") {
    return "A keymap needs a name";
  } else if (name === "next") {
    return "next is the `keymap` command's, so a keymap cannot be named it";
  } else if (others.includes(name)) {
    return `A keymap is already named ${name}`;
  } else {
    return undefined;
  }
};

const objectSchema = z.record(z.string(), z.unknown());

/** The object at `path` as the file has it, without defaults. */
const writtenAt = (
  document: ConfigDocument,
  path: ConfigPath,
): Record<string, unknown> =>
  objectSchema.catch({}).parse(valueAt(document, path));

/** The keymaps as the file has them, without defaults. */
const writtenKeymaps = (document: ConfigDocument): Record<string, unknown>[] =>
  z
    .array(objectSchema)
    .catch([])
    .parse(valueAt(document, ["input", "keyboard", "keymaps"]));

/** `items` with the one at `index` swapped with the one before it. */
const movedUp = <T,>(items: readonly T[], index: number): T[] => {
  const moved = items[index];
  return moved === undefined
    ? [...items]
    : items.toSpliced(index, 1).toSpliced(index - 1, 0, moved);
};

const hintStyles = css({ color: "muted", fontSize: "xs", margin: 0 });

const headerStyles = flex({ align: "center", gap: 2.5 });

const keyboardStyles = cva({
  base: { flexShrink: 0 },
  variants: {
    first: { false: { color: "muted" }, true: { color: "accent" } },
  },
});

const nameStyles = css({
  flex: 1,
  fontSize: "sm",
  fontWeight: "semibold",
  margin: 0,
  minInlineSize: 0,
  overflowWrap: "anywhere",
});

const startsStyles = css({ color: "accent", fontSize: "xs" });
