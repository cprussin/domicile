import { Card } from "@domicile-desktop/component-library/Card";

import type { ConfigPageProps } from "../config-editor";
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

/** `input.keyboard`: the xkb layout. */
export const KeyboardPage = ({
  description,
  editor,
  title,
}: ConfigPageProps) => {
  const { readOnly, report, set, settings } = editor;
  const { keyboard } = settings.input;
  const disabled = readOnly !== undefined;
  return (
    <Page description={description} readOnly={readOnly} title={title}>
      <Card>
        {FIELDS.map((field) => (
          <SettingRow hint={field.hint} key={field.key} title={field.title}>
            <TextSetting
              disabled={disabled}
              label={field.title}
              onCommit={(text) => {
                const value = text.trim();
                if (field.key === "xkb_layout" && value === "") {
                  report("A layout is needed")(
                    "xkb has no layout to fall back on",
                  );
                  return false;
                } else {
                  set(
                    ["input", "keyboard", field.key],
                    value === field.fallback ? undefined : value,
                  );
                  return true;
                }
              }}
              placeholder={field.fallback}
              value={keyboard[field.key]}
            />
          </SettingRow>
        ))}
      </Card>
      <Card title="Options">
        <ListSetting
          addButton="Add option"
          addLabel="Add an option"
          disabled={disabled}
          items={keyboard.xkb_options}
          onChange={(options) => {
            set(
              ["input", "keyboard", "xkb_options"],
              options.length === 0 ? undefined : options,
            );
          }}
          placeholder="caps:escape"
        />
      </Card>
    </Page>
  );
};
