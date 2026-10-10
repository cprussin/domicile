import { Card } from "@domicile-desktop/component-library/Card";

import type { ConfigPageProps } from "../config-editor";
import { Page } from "../Page";
import { SwitchRow } from "../SwitchRow";

/** Each `lockdown` switch, as a person reads it. */
const SWITCHES = [
  { key: "disable_camera", label: "Ask apps not to use the camera" },
  { key: "disable_microphone", label: "Ask apps not to use the microphone" },
  { key: "disable_location", label: "Ask apps not to use your location" },
  { key: "disable_sound_output", label: "Ask apps not to play sound" },
  { key: "disable_printing", label: "Ask apps not to print" },
  { key: "disable_save_to_disk", label: "Ask apps not to save files" },
  {
    key: "disable_application_handlers",
    label: "Ask apps not to open other apps",
  },
] as const;

/** `lockdown`: what apps are asked not to do, through the Lockdown portal. */
export const PrivacyPage = ({
  description,
  editor,
  title,
}: ConfigPageProps) => {
  const { readOnly, set, settings } = editor;
  return (
    <Page description={description} readOnly={readOnly} title={title}>
      <Card>
        {SWITCHES.map(({ key, label }) => (
          <SwitchRow
            checked={settings.lockdown[key]}
            disabled={readOnly !== undefined}
            key={key}
            label={label}
            onChange={(on) => {
              set(["lockdown", key], on ? true : undefined);
            }}
          />
        ))}
      </Card>
    </Page>
  );
};
