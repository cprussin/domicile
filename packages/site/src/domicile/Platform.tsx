import { AppWindowIcon } from "@phosphor-icons/react/dist/ssr/AppWindow";
import { BellIcon } from "@phosphor-icons/react/dist/ssr/Bell";
import { CpuIcon } from "@phosphor-icons/react/dist/ssr/Cpu";
import { CrosshairIcon } from "@phosphor-icons/react/dist/ssr/Crosshair";
import { ExportIcon } from "@phosphor-icons/react/dist/ssr/Export";
import { GlobeIcon } from "@phosphor-icons/react/dist/ssr/Globe";
import { KeyboardIcon } from "@phosphor-icons/react/dist/ssr/Keyboard";
import { LockIcon } from "@phosphor-icons/react/dist/ssr/Lock";
import { MonitorIcon } from "@phosphor-icons/react/dist/ssr/Monitor";
import type { ReactNode } from "react";

import { css } from "../../styled-system/css";
import { flex, grid, hstack } from "../../styled-system/patterns";
import { IconTile } from "../page/IconTile";
import { Section } from "../page/Section";

const FEATURES: readonly {
  code: string;
  icon: ReactNode;
  title: string;
  body: string;
}[] = [
  {
    body: "Every Wayland client is an element you place, size, clip and transform with CSS.",
    code: '<app app-id="…">',
    icon: <AppWindowIcon />,
    title: "Native windows as elements",
  },
  {
    body: "Real Chromium pages in their own browsing context. Draw your own address bar over them.",
    code: '<webview src="…">',
    icon: <GlobeIcon />,
    title: "Browser windows",
  },
  {
    body: "Choose who gets the keyboard: a window, your own UI, or focus follows the mouse.",
    code: "focus / keyboard",
    icon: <CrosshairIcon />,
    title: "Keyboard and focus",
  },
  {
    body: "Bind keys in modes, and let a window inhibit them when it asks.",
    code: "keybindings",
    icon: <KeyboardIcon />,
    title: "Keybindings",
  },
  {
    body: "One page spans all your screens. Hotplug, scale and rotation arrive as events.",
    code: "displays",
    icon: <MonitorIcon />,
    title: "Every monitor, one page",
  },
  {
    body: "Screen sharing, file pickers, screenshots and app choosers all go through your shell.",
    code: "portals",
    icon: <ExportIcon />,
    title: "Portals",
  },
  {
    body: "Tray icons, notifications, theme changes and app dialogs, ready to render.",
    code: "tray / notifications",
    icon: <BellIcon />,
    title: "Desktop events",
  },
  {
    body: "Battery, audio, network and apps come as TypeScript packages over three primitives.",
    code: "files / processes / D-Bus",
    icon: <CpuIcon />,
    title: "System access",
  },
  {
    body: "The compositor blanks and locks the screens. Your shell draws the lock screen.",
    code: "idle / lock",
    icon: <LockIcon />,
    title: "Idle and lock",
  },
];

/** What the SDK gives a shell. */
export const Platform = () => (
  <Section
    id="platform"
    lede="No screenshots, canvas copies or other cowardice: Wayland surfaces go straight into Chromium's layer tree. Here's what the SDK gives a shell."
    title="You draw the desktop. Domicile runs it."
  >
    <div className={gridStyles}>
      {FEATURES.map((feature) => (
        <div className={cardStyles} key={feature.title}>
          <div className={labelStyles}>
            <IconTile>{feature.icon}</IconTile>
            <code className={codeStyles}>{feature.code}</code>
          </div>
          <h3 className={titleStyles}>{feature.title}</h3>
          <p className={bodyStyles}>{feature.body}</p>
        </div>
      ))}
    </div>
  </Section>
);

const gridStyles = grid({ gap: 4, minChildWidth: "16.25rem" });

const cardStyles = flex({
  backgroundColor: "card",
  border: "1px solid {colors.border}",
  borderRadius: "xl",
  direction: "column",
  gap: 2,
  padding: 5,
});

const labelStyles = hstack({ gap: 3 });

const codeStyles = css({ color: "accent", fontFamily: "code", fontSize: "sm" });

const titleStyles = css({
  fontFamily: "display",
  fontSize: "lg",
  fontWeight: "semibold",
});

const bodyStyles = css({ color: "muted", fontSize: "sm" });
