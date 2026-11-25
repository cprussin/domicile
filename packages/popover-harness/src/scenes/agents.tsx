// The agents panel with 12 Claude Code sessions in control.

import { Agents } from "@domicile-desktop/manganese-bar-module-sharing/agents";
import { DomicileProvider } from "@domicile-desktop/react/domicile-provider";
import type { Domicile } from "@domicile-desktop/sdk/desktop/desktop";
import { desktop } from "@domicile-desktop/sdk/desktop/desktop";
import type { PortalsHost } from "@domicile-desktop/sdk/desktop/portals";
import { portals } from "@domicile-desktop/sdk/desktop/portals";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";

import { Bar } from "../Bar";

const SESSIONS = Array.from({ length: 12 }, (_, index) => ({
  app_id: "",
  body: {
    actions: [
      { at_ms: Date.now(), said: "Clicked Submit" },
      { at_ms: Date.now(), said: "Read Pull requests" },
    ],
    agent: "Claude Code",
    reach: {
      type: "windows",
      windows: [
        { id: `w${index.toString()}`, kind: "browser", title: "Pull requests" },
      ],
    },
  },
  id: index + 1,
  kind: "agent",
}));

/** A desktop whose portals say `SESSIONS` are in control, as listeners join. */
const PORTALS_HOST = {
  addEventListener: (
    _type: "portalrequests",
    listener: (event: MessageEvent<string>) => void,
  ) => {
    queueMicrotask(() => {
      listener(
        new MessageEvent("portalrequests", {
          data: JSON.stringify({
            capturing: SESSIONS,
            items: [],
            type: "portal_requests",
          }),
        }),
      );
    });
  },
  answerPortalRequest: () => undefined,
  removeEventListener: () => undefined,
} as unknown as PortalsHost;

const SEATS = desktop(new FakeDomicileHost().host);

const DOMICILE: Domicile = {
  ...SEATS,
  portals: portals(PORTALS_HOST, {
    agents: () => {
      throw new Error("the bar lists no remembered agents");
    },
    forgetAgent: () => {
      throw new Error("the bar forgets no agents");
    },
  }),
};

export const AgentsScene = () => (
  <DomicileProvider domicile={DOMICILE}>
    <Bar>
      <Agents />
    </Bar>
  </DomicileProvider>
);
