// Every crowded popover the harness checks. Add one by adding its scene here.

import type { Crowd } from "./crowd";
import { AgentsScene } from "./scenes/agents";
import { DownloadsScene } from "./scenes/downloads";
import { NotificationsScene } from "./scenes/notifications";
import { QuickSettingsScene } from "./scenes/quick-settings";
import { TrayScene } from "./scenes/tray";

export const CROWDS: readonly Crowd[] = [
  {
    arrive: "Message 40",
    id: "notifications",
    last: "Message 1",
    presses: ["Notifications"],
    Scene: NotificationsScene,
    shrink: "Clear all",
    toggle: { off: ["Resume"], on: ["Pause", "For 1 hour"] },
  },
  {
    id: "agents",
    last: "Stop all",
    presses: ["12 Claude Code sessions"],
    Scene: AgentsScene,
  },
  {
    id: "downloads",
    last: "report-01.pdf",
    presses: ["Downloading 1 file, 25%"],
    Scene: DownloadsScene,
    shrink: "Clear all",
  },
  {
    drawer: "Details",
    grow: ["Back", "Bluetooth details"],
    id: "quick-settings",
    last: "Network 40",
    presses: ["Quick settings", "Wi-Fi details"],
    Scene: QuickSettingsScene,
  },
  {
    id: "tray",
    last: "Extension 10 – A Name Longer Than Its Row",
    presses: ["All tray icons"],
    Scene: TrayScene,
  },
];
