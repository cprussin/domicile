// The desktop the "Make your own desktop" preview runs a shell on.

import type { Domicile } from "@domicile-desktop/sdk/desktop/desktop";
import { desktop } from "@domicile-desktop/sdk/desktop/desktop";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";

import type { StandIn } from "./stand-ins";
import { STAND_INS } from "./stand-ins";

/**
 * A test desktop with the stand-in windows. Focusing a window moves the
 * focus, as the engine does, so the shell's focus UI works. Launching a
 * command opens a stand-in for it, so the shell's launcher works too.
 */
export const previewDesktop = (): {
  domicile: Domicile;
  /** Every window's stand-in, those launched included. */
  standIns: () => readonly StandIn[];
} => {
  const fake = new FakeDomicileHost();
  const standIns: StandIn[] = [...STAND_INS];
  for (const { appId, title } of STAND_INS) {
    fake.appear(appId, { title });
  }
  fake.set({ focusedWindow: STAND_INS[0].appId });
  const launch = (argv: readonly string[]) => {
    const [command] = argv;
    if (command === undefined) {
      throw new Error("launch needs a command");
    }
    const launched = {
      appId: `launched-${String(standIns.length - STAND_INS.length + 1)}`,
      body: `$ ${argv.join(" ")}`,
      title: command,
    };
    standIns.push(launched);
    fake.appear(launched.appId, { title: launched.title });
  };
  const host = new Proxy(fake.host, {
    get: (target, name, receiver) => {
      switch (name) {
        case "focusApp": {
          return (appId: string) => fake.set({ focusedWindow: appId });
        }
        case "spawn": {
          return launch;
        }
        default: {
          return Reflect.get(target, name, receiver);
        }
      }
    },
  });
  return { domicile: desktop(host), standIns: () => standIns };
};
