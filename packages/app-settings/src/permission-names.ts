import type { Permission, Setting } from "./host";

/** Each permission as a person reads it. */
export const PERMISSION_TITLES: Readonly<Record<Permission, string>> = {
  camera: "Camera",
  clipboard: "Clipboard",
  location: "Location",
  microphone: "Microphone",
  midi: "MIDI devices",
  notifications: "Notifications",
};

/** The choices for a site's setting. */
export const SETTING_OPTIONS: readonly { label: string; value: Setting }[] = [
  { label: "Ask", value: "ask" },
  { label: "Allow", value: "allow" },
  { label: "Block", value: "block" },
];

/** A setting as a person reads it. */
export const settingTitle = (setting: Setting): string => {
  switch (setting) {
    case "ask":
      return "Ask";
    case "allow":
      return "Allow";
    case "block":
      return "Block";
  }
};
