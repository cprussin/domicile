// How the shell names each permission a page can ask for.

import type { WebViewPermission } from "@domicile-desktop/sdk/webview-element";
import { AppWindowIcon } from "@phosphor-icons/react/dist/ssr/AppWindow";
import { BellIcon } from "@phosphor-icons/react/dist/ssr/Bell";
import { CameraIcon } from "@phosphor-icons/react/dist/ssr/Camera";
import { ClipboardIcon } from "@phosphor-icons/react/dist/ssr/Clipboard";
import { DesktopIcon } from "@phosphor-icons/react/dist/ssr/Desktop";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/ssr/DownloadSimple";
import { MapPinIcon } from "@phosphor-icons/react/dist/ssr/MapPin";
import { MicrophoneIcon } from "@phosphor-icons/react/dist/ssr/Microphone";
import { PianoKeysIcon } from "@phosphor-icons/react/dist/ssr/PianoKeys";
import { TextAaIcon } from "@phosphor-icons/react/dist/ssr/TextAa";
import type { ReactNode } from "react";

/** Each permission's name, as Chrome's site settings word it. */
export const PERMISSION_LABELS: Readonly<Record<WebViewPermission, string>> = {
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

export const PERMISSION_ICONS: Readonly<Record<WebViewPermission, ReactNode>> =
  {
    "automatic-downloads": <DownloadSimpleIcon size={14} />,
    camera: <CameraIcon size={14} />,
    clipboard: <ClipboardIcon size={14} />,
    "idle-detection": <DesktopIcon size={14} />,
    "local-fonts": <TextAaIcon size={14} />,
    location: <MapPinIcon size={14} />,
    microphone: <MicrophoneIcon size={14} />,
    midi: <PianoKeysIcon size={14} />,
    notifications: <BellIcon size={14} />,
    "window-management": <AppWindowIcon size={14} />,
  };
