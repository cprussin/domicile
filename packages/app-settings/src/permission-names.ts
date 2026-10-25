import type { Permission, Setting } from "./host";

/** Each permission as a person reads it. */
export const PERMISSION_TITLES: Readonly<Record<Permission, string>> = {
  "automatic-downloads": "Automatic downloads",
  camera: "Camera",
  clipboard: "Clipboard",
  "idle-detection": "Your device use",
  "local-fonts": "Fonts",
  location: "Location",
  microphone: "Microphone",
  midi: "MIDI devices",
  notifications: "Notifications",
  "window-management": "Window management",
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
