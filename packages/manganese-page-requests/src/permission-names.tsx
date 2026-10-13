// How the shell names each permission a page can ask for.

import type { WebViewPermission } from "@domicile-desktop/sdk/webview-element";
import { BellIcon } from "@phosphor-icons/react/dist/ssr/Bell";
import { CameraIcon } from "@phosphor-icons/react/dist/ssr/Camera";
import { ClipboardIcon } from "@phosphor-icons/react/dist/ssr/Clipboard";
import { MapPinIcon } from "@phosphor-icons/react/dist/ssr/MapPin";
import { MicrophoneIcon } from "@phosphor-icons/react/dist/ssr/Microphone";
import { PianoKeysIcon } from "@phosphor-icons/react/dist/ssr/PianoKeys";
import type { ReactNode } from "react";

/** Each permission's name, as Chrome's site settings word it. */
export const PERMISSION_LABELS: Readonly<Record<WebViewPermission, string>> = {
  camera: "Camera",
  clipboard: "Clipboard",
  location: "Location",
  microphone: "Microphone",
  midi: "MIDI devices",
  notifications: "Notifications",
};

export const PERMISSION_ICONS: Readonly<Record<WebViewPermission, ReactNode>> =
  {
    camera: <CameraIcon size={14} />,
    clipboard: <ClipboardIcon size={14} />,
    location: <MapPinIcon size={14} />,
    microphone: <MicrophoneIcon size={14} />,
    midi: <PianoKeysIcon size={14} />,
    notifications: <BellIcon size={14} />,
  };
