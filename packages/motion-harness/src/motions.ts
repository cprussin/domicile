// Every motion the harness checks and the slowed page plays. Add a motion by
// adding its scene here.

import type { Motion } from "./motion";
import { OverviewOpenScene, OverviewSwapScene } from "./scenes/overview";

export const MOTIONS: readonly Motion[] = [
  {
    id: "overview-open",
    name: "Overview open / close",
    Scene: OverviewOpenScene,
  },
  { id: "overview-swap", name: "Overview card swap", Scene: OverviewSwapScene },
];
