// The desktop the "Make your own desktop" preview runs a shell on.

import type { Domicile } from "@domicile-desktop/sdk/desktop/desktop";
import { desktop } from "@domicile-desktop/sdk/desktop/desktop";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";

import { STAND_INS } from "./stand-ins";

/**
 * A test desktop with the stand-in windows. Focusing a window moves the
 * focus, as the engine does, so the shell's focus UI works.
 */
export const previewDesktop = (): { domicile: Domicile } => {
  const fake = new FakeDomicileHost();
  for (const { appId, title } of STAND_INS) {
    fake.appear(appId, { title });
  }
  fake.set({ focusedWindow: STAND_INS[0].appId });
  const host = new Proxy(fake.host, {
    get: (target, name, receiver) =>
      name === "focusApp"
        ? (appId: string) => fake.set({ focusedWindow: appId })
        : Reflect.get(target, name, receiver),
  });
  return { domicile: desktop(host) };
};
