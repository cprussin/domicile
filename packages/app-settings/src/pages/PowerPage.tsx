import { Card } from "@domicile-desktop/component-library/Card";

import type { ConfigEditor, ConfigPageProps } from "../config-editor";
import { Page } from "../Page";
import { SettingRow } from "../SettingRow";
import { TextSetting } from "../TextSetting";

/** `idle` and `lock`: when the screens go dark, when the desktop locks, and how it unlocks. */
export const PowerPage = ({ description, editor, title }: ConfigPageProps) => {
  const { readOnly, set, settings } = editor;
  const { idle, lock } = settings;
  const disabled = readOnly !== undefined;
  return (
    <Page description={description} readOnly={readOnly} title={title}>
      <Card>
        <SettingRow
          hint="With no input for this long, the screens go dark. Empty is never."
          title="Blank the screens after"
        >
          <TextSetting
            disabled={disabled}
            label="Blank the screens after (seconds)"
            onCommit={commitSeconds(editor, "blank_after_seconds")}
            placeholder="Never"
            value={idle.blank_after_seconds?.toString() ?? ""}
            width={28}
          />
        </SettingRow>
      </Card>
      <Card title="Lock">
        <SettingRow
          hint="With no input for this long, the desktop locks, on its own clock from blanking. Empty is only when the shell asks."
          title="Lock after"
        >
          <TextSetting
            disabled={disabled}
            label="Lock after (seconds)"
            onCommit={commitSeconds(editor, "lock_after_seconds")}
            placeholder="Never"
            value={idle.lock_after_seconds?.toString() ?? ""}
            width={28}
          />
        </SettingRow>
        <SettingRow
          hint="Your password unlocks the desktop, checked by this PAM service in /etc/pam.d. Empty is domicile. Applies when saved; saving never unlocks a locked desktop."
          title="PAM service"
        >
          <TextSetting
            disabled={disabled}
            label="PAM service"
            onCommit={(service) => {
              set(
                ["lock", "pam_service"],
                service === "" ? undefined : service,
              );
              return true;
            }}
            placeholder="domicile"
            value={lock.pam_service ?? ""}
          />
        </SettingRow>
      </Card>
    </Page>
  );
};

/** Commits a whole number of seconds to `idle.<key>`, or removes it when empty. */
const commitSeconds =
  (
    { report, set }: ConfigEditor,
    key: "blank_after_seconds" | "lock_after_seconds",
  ) =>
  (text: string): boolean => {
    const seconds = Number(text.trim());
    if (text.trim() === "") {
      set(["idle", key], undefined);
      return true;
    } else if (Number.isInteger(seconds) && seconds > 0) {
      set(["idle", key], seconds);
      return true;
    } else {
      report("Not a time")(`${text} is not a whole number of seconds`);
      return false;
    }
  };
