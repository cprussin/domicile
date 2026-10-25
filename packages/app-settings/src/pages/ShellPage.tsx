import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";
import { Card } from "@domicile-desktop/component-library/Card";
import { Select } from "@domicile-desktop/component-library/Select";
import type { Option, Options } from "@domicile-desktop/sdk/options";
import {
  optionProblem,
  optionsSchema,
  readOption,
} from "@domicile-desktop/sdk/options";
import { z } from "zod";

import { css } from "../../styled-system/css";
import type { ConfigPath } from "../config-document";
import { parseDocument, valueAt } from "../config-document";
import type { ConfigEditor, ConfigPageProps } from "../config-editor";
import { ListSetting } from "../ListSetting";
import { Notice } from "../Notice";
import { Page } from "../Page";
import { SettingRow } from "../SettingRow";
import { SwitchRow } from "../SwitchRow";
import { TextSetting } from "../TextSetting";

type Props = ConfigPageProps & {
  /** The shell's `options.json`, or `undefined` if it declares none. */
  declared: string | undefined;
};

/**
 * `shell_options`: one control per option the shell declares, and a card per
 * group. See `docs/WRITING-A-SHELL.md#options`.
 */
export const ShellPage = ({ declared, description, editor, title }: Props) => (
  <Page description={description} readOnly={editor.readOnly} title={title}>
    {declared === undefined ? (
      <p className={hintStyles}>This shell declares no options.</p>
    ) : (
      readDeclaration(declared).match({
        Err: (why) => (
          <Notice tone="danger">
            The shell's options cannot be read: {why}
          </Notice>
        ),
        Ok: (options) => (
          <OptionCards editor={editor} options={options} path={[]} />
        ),
      })
    )}
  </Page>
);

type OptionCardsProps = {
  editor: ConfigEditor;
  options: Options;
  /** The keys under `shell_options` down to `options`. */
  path: readonly string[];
};

/** A card of the options in a group, then one for each group in it. */
const OptionCards = ({ editor, options, path }: OptionCardsProps) => {
  const entries = Object.entries(options);
  const own = entries.flatMap(([key, entry]) =>
    entry.kind === "group" ? [] : [{ entry, key }],
  );
  const groups = entries.flatMap(([key, entry]) =>
    entry.kind === "group" ? [{ entry, key }] : [],
  );
  const title = path.length === 0 ? undefined : path.map(inWords).join(" › ");
  return (
    <>
      {own.length > 0 && (
        <Card title={title}>
          {own.map(({ entry, key }) => (
            <OptionRow
              editor={editor}
              key={key}
              option={entry}
              path={["shell_options", ...path, key]}
            />
          ))}
        </Card>
      )}
      {groups.map(({ entry, key }) => (
        <OptionCards
          editor={editor}
          key={key}
          options={entry.options}
          path={[...path, key]}
        />
      ))}
    </>
  );
};

type OptionRowProps = {
  editor: ConfigEditor;
  option: Option;
  path: ConfigPath;
};

/** The control for one option. A value set back to its default is removed. */
const OptionRow = ({ editor, option, path }: OptionRowProps) => {
  const { readOnly, report, set, settings } = editor;
  const disabled = readOnly !== undefined;
  const given = valueAt(settings.shell_options, path.slice(1));
  switch (option.kind) {
    case "toggle":
      return (
        <SwitchRow
          checked={readOption(option, given)}
          disabled={disabled}
          label={option.label}
          onChange={(on) => {
            set(path, on === option.default ? undefined : on);
          }}
        />
      );
    case "choice":
      return (
        <SettingRow title={option.label}>
          <Select
            aria-label={option.label}
            disabled={disabled}
            onValueChange={(choice) => {
              set(path, choice === option.default ? undefined : choice);
            }}
            options={option.choices.map((choice) => ({
              label: choice,
              value: choice,
            }))}
            size="sm"
            value={readOption(option, given)}
            width={36}
          />
        </SettingRow>
      );
    case "number":
      return (
        <SettingRow title={option.label}>
          <TextSetting
            disabled={disabled}
            label={option.label}
            onCommit={(text) => {
              const number = Number(text.trim());
              const problem =
                text.trim() === ""
                  ? "is not a number"
                  : optionProblem(option, number);
              if (problem === undefined) {
                set(path, number === option.default ? undefined : number);
                return true;
              } else {
                report(`Not a value for ${option.label}`)(
                  `${text.trim()} ${problem}`,
                );
                return false;
              }
            }}
            value={readOption(option, given).toString()}
            width={28}
          />
        </SettingRow>
      );
    case "text":
      return (
        <SettingRow title={option.label}>
          <TextSetting
            disabled={disabled}
            label={option.label}
            onCommit={(text) => {
              set(path, text === option.default ? undefined : text);
              return true;
            }}
            value={readOption(option, given)}
          />
        </SettingRow>
      );
    case "list":
      return (
        <SettingRow title={option.label}>
          <ListSetting
            addButton="Add"
            addLabel={`Add to ${option.label}`}
            disabled={disabled}
            items={readOption(option, given)}
            onChange={(items) => {
              set(
                path,
                items.join("\n") === option.default.join("\n")
                  ? undefined
                  : items,
              );
            }}
          />
        </SettingRow>
      );
  }
};

/** The declaration in `text`, or why it is not one. */
const readDeclaration = (text: string): Result<Options, string> =>
  parseDocument(text).andThen((document) => {
    const read = optionsSchema.safeParse(document);
    return read.success ? Ok(read.data) : Err(z.prettifyError(read.error));
  });

/** A camelCase key as a title: `nightLight` is "Night light". */
const inWords = (key: string): string => {
  const words = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
};

const hintStyles = css({ color: "muted", fontSize: "sm", margin: 0 });
