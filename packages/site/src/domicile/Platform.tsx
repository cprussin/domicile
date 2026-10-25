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
import { CodeBlock } from "../code/CodeBlock";
import { IconTile } from "../page/IconTile";
import { Section } from "../page/Section";

const FEATURES: readonly {
  code: string;
  icon: ReactNode;
  title: string;
  body: string;
  /** A few lines showing it in use. */
  example: string;
}[] = [
  {
    body: "Every Wayland client is an element you place, size, clip and transform with CSS.",
    code: '<app app-id="…">',
    example: "{domicile.windows.map((w) => (\n  <app app-id={w.appId} />\n))}",
    icon: <AppWindowIcon />,
    title: "Native windows as elements",
  },
  {
    body: "Full web pages in their own browsing context. Draw your own address bar over them.",
    code: '<webview src="…">',
    example:
      "domicile.openBrowserWindow(url);\n\n// then, for each browser window:\n<webview window={tab.id} />",
    icon: <GlobeIcon />,
    title: "Browser windows",
  },
  {
    body: "Choose who gets the keyboard: a window, your own UI, or focus follows the mouse.",
    code: "focus / keyboard",
    example:
      "// focus follows the mouse\napp.onpointerenter = () =>\n  domicile.focusApp(appId);",
    icon: <CrosshairIcon />,
    title: "Keyboard and focus",
  },
  {
    body: "Bind keys in modes, and let a window inhibit them when it asks.",
    code: "keybindings",
    example:
      'const keybindings = {\n  "Super+Return":\n    KeyAction.SendShell(["term"]),\n};\nbindKeys(domicile, { keybindings },\n  handlers);',
    icon: <KeyboardIcon />,
    title: "Keybindings",
  },
  {
    body: "One page spans all your screens. Hotplug, scale and rotation arrive as events.",
    code: "displays",
    example:
      "domicile.displays?.forEach((d) =>\n  placeBar(d.x, d.y, d.width),\n);",
    icon: <MonitorIcon />,
    title: "Every monitor, one page",
  },
  {
    body: "Screen sharing, file pickers, screenshots and app choosers all go through your shell.",
    code: "portals",
    example:
      "watchPortalRequests(domicile,\n  (requests) => show(requests),\n);",
    icon: <ExportIcon />,
    title: "Portals",
  },
  {
    body: "Tray icons, notifications, theme changes and app dialogs, ready to render.",
    code: "tray / notifications",
    example:
      'domicile.addEventListener(\n  "traychanged",\n  () => render(domicile.tray),\n);',
    icon: <BellIcon />,
    title: "Desktop events",
  },
  {
    body: "Battery, audio, network and apps come as TypeScript packages over three primitives.",
    code: "files / processes / D-Bus",
    example:
      'const sys = system(domicile);\nawait sys.readTextFile(path);\nawait sys.run(["brightnessctl"]);',
    icon: <CpuIcon />,
    title: "System access",
  },
  {
    body: "The compositor blanks and locks the screens. Your shell draws the lock screen.",
    code: "idle / lock",
    example:
      'domicile.addEventListener(\n  "lockedchanged", drawLockScreen,\n);\ndomicile.unlock(passphrase);',
    icon: <LockIcon />,
    title: "Idle and lock",
  },
];

/** What the SDK gives a shell. */
export const Platform = () => (
  <Section
    id="platform"
    lede="Domicile is built on Chromium and keeps up with it. Here's what the SDK gives a shell."
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
          <CodeBlock code={feature.example} language="tsx" />
        </div>
      ))}
    </div>
  </Section>
);

const gridStyles = grid({ gap: 4, minChildWidth: "20rem" });

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
