import { Card } from "@domicile-desktop/component-library/Card";
import { Select } from "@domicile-desktop/component-library/Select";
import { useState } from "react";

import type { ConfigPageProps } from "../config-editor";
import type { Settings } from "../config-schema";
import { Page } from "../Page";
import { SettingRow } from "../SettingRow";
import { TextSetting } from "../TextSetting";

/** How the desktop unlocks: `lock` sets one of these, or neither. */
enum Unlock {
  Never = "never",
  Password = "password",
  Passphrase = "passphrase",
}

const UNLOCKS = [
  { label: "Don't lock", value: Unlock.Never },
  { label: "Your password", value: Unlock.Password },
  { label: "A passphrase", value: Unlock.Passphrase },
] as const;

/** `idle` and `lock`: when the screens go dark, and how the desktop unlocks. */
export const PowerPage = ({ description, editor, title }: ConfigPageProps) => {
  const { readOnly, report, set, settings } = editor;
  const { idle, lock } = settings;
  const disabled = readOnly !== undefined;
  // Chosen before its field is filled in, since an empty one is refused.
  const [unlock, setUnlock] = useState(unlockOf(lock));
  // Sets the lock to `key` alone, refusing an empty value.
  const commitLock = (key: "pam_service" | "passphrase", text: string) => {
    if (text === "") {
      report("Can't unlock with nothing")("Fill this in, or pick Don't lock");
      return false;
    } else {
      set(["lock"], { [key]: text });
      return true;
    }
  };
  return (
    <Page description={description} readOnly={readOnly} title={title}>
      <Card>
        <SettingRow
          hint="With no input for this long, the screens go dark, and lock if locking is on. Empty is never."
          title="Blank the screens after"
        >
          <TextSetting
            disabled={disabled}
            label="Blank the screens after (seconds)"
            onCommit={(text) => {
              const seconds = Number(text.trim());
              if (text.trim() === "") {
                set(["idle", "blank_after_seconds"], undefined);
                return true;
              } else if (Number.isInteger(seconds) && seconds > 0) {
                set(["idle", "blank_after_seconds"], seconds);
                return true;
              } else {
                report("Not a time")(
                  `${text} is not a whole number of seconds`,
                );
                return false;
              }
            }}
            placeholder="Never"
            value={idle.blank_after_seconds?.toString() ?? ""}
            width={28}
          />
        </SettingRow>
      </Card>
      <Card title="Lock">
        <SettingRow
          hint="Read when the desktop starts, so a change applies at the next start."
          title="Unlock with"
        >
          <Select
            aria-label="Unlock with"
            disabled={disabled}
            onValueChange={(chosen) => {
              if (chosen !== null) {
                setUnlock(chosen);
                if (chosen === Unlock.Never) {
                  set(["lock"], undefined);
                }
              }
            }}
            options={UNLOCKS}
            size="sm"
            value={unlock}
            width={44}
          />
        </SettingRow>
        {unlock === Unlock.Password && (
          <SettingRow
            hint="The PAM service that checks your password, declared in /etc/pam.d."
            title="PAM service"
          >
            <TextSetting
              disabled={disabled}
              label="PAM service"
              onCommit={(service) => commitLock("pam_service", service)}
              placeholder="domicile"
              value={lock.pam_service ?? ""}
            />
          </SettingRow>
        )}
        {unlock === Unlock.Passphrase && (
          <SettingRow
            hint="Kept in the config in plain text, which on NixOS anyone can read."
            title="Passphrase"
          >
            <TextSetting
              disabled={disabled}
              label="Passphrase"
              onCommit={(passphrase) => commitLock("passphrase", passphrase)}
              value={lock.passphrase ?? ""}
            />
          </SettingRow>
        )}
      </Card>
    </Page>
  );
};

const unlockOf = (lock: Settings["lock"]): Unlock => {
  if (lock.pam_service !== undefined) {
    return Unlock.Password;
  } else if (lock.passphrase === undefined) {
    return Unlock.Never;
  } else {
    return Unlock.Passphrase;
  }
};
