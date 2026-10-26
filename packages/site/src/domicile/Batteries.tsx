import { ApertureIcon } from "@phosphor-icons/react/dist/ssr/Aperture";
import { ClipboardTextIcon } from "@phosphor-icons/react/dist/ssr/ClipboardText";
import { CodeIcon } from "@phosphor-icons/react/dist/ssr/Code";
import { CommandIcon } from "@phosphor-icons/react/dist/ssr/Command";
import { GlobeIcon } from "@phosphor-icons/react/dist/ssr/Globe";
import { KeyboardIcon } from "@phosphor-icons/react/dist/ssr/Keyboard";
import { LockKeyIcon } from "@phosphor-icons/react/dist/ssr/LockKey";
import { MonitorIcon } from "@phosphor-icons/react/dist/ssr/Monitor";
import { PrinterIcon } from "@phosphor-icons/react/dist/ssr/Printer";
import { TrayIcon } from "@phosphor-icons/react/dist/ssr/Tray";
import { VideoCameraIcon } from "@phosphor-icons/react/dist/ssr/VideoCamera";
import { WifiHighIcon } from "@phosphor-icons/react/dist/ssr/WifiHigh";
import type { ReactNode } from "react";

import { css } from "../../styled-system/css";
import { flex, grid } from "../../styled-system/patterns";
import { IconTile } from "../page/IconTile";
import { Section } from "../page/Section";
import {
  CastPicture,
  ExtensionsPicture,
  NightLightPicture,
  NotificationsPicture,
  SharingPicture,
  ThemePicture,
} from "./BatteryPictures";

const SHOWN: readonly { picture: ReactNode; title: string; body: string }[] = [
  {
    body: "Install extensions from the Chrome Web Store. They work in every web window, and their buttons can sit in your bar.",
    picture: <ExtensionsPicture />,
    title: "Chrome extensions",
  },
  {
    body: "Native apps and web pages land in the same list, with one do not disturb switch.",
    picture: <NotificationsPicture />,
    title: "One place for notifications",
  },
  {
    body: "Share a window, a monitor or a region from any video call or OBS, with its sound. Your shell draws the picker.",
    picture: <SharingPicture />,
    title: "Screen sharing",
  },
  {
    body: "Mirror to Chromecast and Miracast TVs, or use the TV as one more monitor.",
    picture: <CastPicture />,
    title: "Cast to a TV",
  },
  {
    body: "Warm every screen in the evening with one call. Brightness can follow the light sensor, the way a Mac does.",
    picture: <NightLightPicture />,
    title: "Night light and auto brightness",
  },
  {
    body: "GTK, Qt and Chromium apps follow your light or dark theme and your accent color. Websites can go dark too.",
    picture: <ThemePicture />,
    title: "Dark mode everywhere",
  },
];

const LISTED: readonly { icon: ReactNode; title: string; body: string }[] = [
  {
    body: "Capture a window, a monitor or a region, to a file or the clipboard.",
    icon: <ApertureIcon />,
    title: "Screenshots and recording",
  },
  {
    body: "Write real desktop apps with HTML, CSS and JavaScript. They run on the engine Domicile already has, so there is no browser to bundle.",
    icon: <CodeIcon />,
    title: "Web Native Apps - no Electron needed",
  },
  {
    body: "Install any website as an app, with its own window and icon.",
    icon: <GlobeIcon />,
    title: "Sites as apps",
  },
  {
    body: "Open and save dialogs, print or save as PDF, open with, remote desktop and the keyring, all in your look.",
    icon: <PrinterIcon />,
    title: "File pickers, printing and more",
  },
  {
    body: "Copied something a while ago? Find it again and paste it, whether it came from an app or a website.",
    icon: <ClipboardTextIcon />,
    title: "Clipboard history",
  },
  {
    body: "Plug into a dock and your monitors snap back to where you left them.",
    icon: <MonitorIcon />,
    title: "Monitor profiles",
  },
  {
    body: "Discord, Steam and every other app that puts an icon in the tray just works.",
    icon: <TrayIcon />,
    title: "Tray icons",
  },
  {
    body: "Ready-made packages for the controls every desktop needs. Add the menus, not the plumbing.",
    icon: <WifiHighIcon />,
    title: "Wi-Fi, Bluetooth, sound and battery",
  },
  {
    body: "When a site asks for your camera, microphone or location, your shell asks you, and remembers the answer.",
    icon: <VideoCameraIcon />,
    title: "Website permissions",
  },
  {
    body: "The compositor holds the lock and checks your password, so even a shell that crashes never unlocks the desktop.",
    icon: <LockKeyIcon />,
    title: "A lock screen that stays locked",
  },
  {
    body: "Switch between layouts on the fly, and type in any language with an input method.",
    icon: <KeyboardIcon />,
    title: "Keyboard layouts",
  },
  {
    body: "Push to talk in Discord, or a hotkey for your music app, works even when the app is in the background.",
    icon: <CommandIcon />,
    title: "Global shortcuts",
  },
];

/** What Domicile builds in, so every shell gets it. */
export const Batteries = () => (
  <Section
    id="batteries"
    lede="Screen sharing, night light, notifications and the rest come built into Domicile, so every shell gets them for free. Your shell just draws the buttons."
    title="Batteries included."
  >
    <div className={shownStyles}>
      {SHOWN.map((feature) => (
        <div className={shownCardStyles} key={feature.title}>
          {feature.picture}
          <h3 className={shownTitleStyles}>{feature.title}</h3>
          <p className={bodyStyles}>{feature.body}</p>
        </div>
      ))}
    </div>
    <div className={listedStyles}>
      {LISTED.map((feature) => (
        <div className={listedCardStyles} key={feature.title}>
          <IconTile>{feature.icon}</IconTile>
          <h3 className={listedTitleStyles}>{feature.title}</h3>
          <p className={bodyStyles}>{feature.body}</p>
        </div>
      ))}
    </div>
  </Section>
);

const shownStyles = grid({
  gap: 4,
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 26rem), 1fr))",
  marginBlockEnd: 4,
});

const shownCardStyles = flex({
  backgroundColor: "card",
  border: "1px solid {colors.border}",
  borderRadius: "xl",
  direction: "column",
  gap: 2,
  padding: 6,
});

const shownTitleStyles = css({
  fontFamily: "display",
  fontSize: "xl",
  fontWeight: "semibold",
  marginBlockStart: 2,
});

const listedStyles = grid({ gap: 4, minChildWidth: "16rem" });

const listedCardStyles = flex({
  backgroundColor: "card",
  border: "1px solid {colors.border}",
  borderRadius: "xl",
  direction: "column",
  gap: 2,
  padding: 5,
});

const listedTitleStyles = css({
  fontFamily: "display",
  fontSize: "lg",
  fontWeight: "semibold",
});

const bodyStyles = css({ color: "muted", fontSize: "sm" });
