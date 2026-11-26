// The agents panel with 12 Claude Code sessions in control, each holding a
// window whose title is too long for its row.

import { Agents } from "@domicile-desktop/manganese-bar-module-sharing/agents";
import { DomicileProvider } from "@domicile-desktop/react/domicile-provider";
import type { Domicile } from "@domicile-desktop/sdk/desktop/desktop";
import { desktop } from "@domicile-desktop/sdk/desktop/desktop";
import type { PortalsHost } from "@domicile-desktop/sdk/desktop/portals";
import { portals } from "@domicile-desktop/sdk/desktop/portals";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";

import { Bar } from "../Bar";

/** A window title too long for a row, so it must not squeeze the row's button. */
const LONG_TITLE = "Sample File Upload Form on a page with a long title";

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
        {
          id: `w${(index + 1).toString()}`,
          kind: "browser",
          title: LONG_TITLE,
        },
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

/** A desktop where each session's seat types in a window of its own. */
const seatsHost = (): FakeDomicileHost => {
  const host = new FakeDomicileHost();
  for (const session of SESSIONS) {
    host.appear(`w${session.id.toString()}`, { title: LONG_TITLE });
  }
  host.set({
    seats: SESSIONS.map((session) => ({
      focused: `w${session.id.toString()}`,
      holds: [`w${session.id.toString()}`],
      id: `agent-${session.id.toString()}`,
      name: "Claude Code",
      pointerX: null,
      pointerY: null,
      taken: [],
    })),
  });
  return host;
};

const SEATS = desktop(seatsHost().host);

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
