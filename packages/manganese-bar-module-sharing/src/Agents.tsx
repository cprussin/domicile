import { Button } from "@domicile-desktop/component-library/Button";
import { Popover } from "@domicile-desktop/component-library/Popover";
import type { Browser } from "@domicile-desktop/sdk/desktop/browser";
import type { Portals } from "@domicile-desktop/sdk/desktop/portals";
import type { Seat, Seats } from "@domicile-desktop/sdk/desktop/seats";
import type { Windows } from "@domicile-desktop/sdk/desktop/windows";
import type { Capturing } from "@domicile-desktop/sdk/portal";
import { CapturingKind } from "@domicile-desktop/sdk/portal";
import { PauseIcon } from "@phosphor-icons/react/dist/ssr/Pause";
import { RobotIcon } from "@phosphor-icons/react/dist/ssr/Robot";
import { SlidersHorizontalIcon } from "@phosphor-icons/react/dist/ssr/SlidersHorizontal";
import { StopIcon } from "@phosphor-icons/react/dist/ssr/Stop";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { css } from "../styled-system/css";
import { center, flex, hstack } from "../styled-system/patterns";

/** An agent the user let in. */
export type Agent = Extract<Capturing, { kind: CapturingKind.Agent }>;

const LIST = new Intl.ListFormat("en", { type: "conjunction" });

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/** How often "1 min ago" moves on while the panel is open. */
const TICK_MS = 15 * 1000;

/**
 * What the agents item reads: the agents in control, their seats, and the
 * titles of the client and browser windows they use.
 */
export type AgentsDesktop = {
  readonly browser: Pick<Browser, "on" | "windows">;
  readonly portals: Pick<
    Portals,
    "capturing" | "changeAgent" | "on" | "stopCapturing"
  >;
  readonly seats: Pick<Seats, "giveBack" | "list" | "on" | "takeOver">;
  readonly windows: Pick<Windows, "list" | "on">;
};

/**
 * Top bar agents item: one violet pill for every agent session in control,
 * such as Claude Code, named as the agent names itself. Its panel says what
 * each session can reach and did last, with buttons that change what it
 * reaches and stop it.
 */
export const Agents = ({ domicile }: { domicile: AgentsDesktop }) => {
  const [agents, setAgents] = useState<readonly Agent[]>([]);

  useEffect(() => {
    const { portals } = domicile;
    const heard = () => {
      setAgents(
        (portals.capturing ?? []).filter((session) => isAgent(session)),
      );
    };
    heard();
    return portals.on("change", heard);
  }, [domicile]);
  const { uses } = useUses(domicile);

  const [first, ...rest] = agents;
  // Nothing at all when none is in, so the bar closes the item.
  return first === undefined ? undefined : (
    <Pill
      agents={[first, ...rest]}
      change={(agent) => {
        domicile.portals.changeAgent(agent.id);
      }}
      giveBack={domicile.seats.giveBack}
      stop={(agent) => {
        domicile.portals.stopCapturing(agent.id);
      }}
      takeOver={domicile.seats.takeOver}
      uses={uses}
    />
  );
};

/** How an agent uses a window. */
type How = "typing" | "pointing" | "taken";

/** A window an agent uses, or that the user took from it. */
type Use = { appId: string; how: How; title: string };

/** The windows each agent uses, by its session's id. */
const useUses = (
  domicile: AgentsDesktop,
): {
  /** The windows `agent` uses. */
  uses: (agent: Agent) => readonly Use[];
} => {
  const { browser, seats, windows } = domicile;
  const seatsChanged = useCallback(
    (changed: () => void) => seats.on("change", changed),
    [seats],
  );
  const windowsChanged = useCallback(
    (changed: () => void) => windows.on("change", changed),
    [windows],
  );
  const browserChanged = useCallback(
    (changed: () => void) => browser.on("change", changed),
    [browser],
  );
  const list = useSyncExternalStore(seatsChanged, () => seats.list);
  const titled = useSyncExternalStore(windowsChanged, () => windows.list);
  const pages = useSyncExternalStore(browserChanged, () => browser.windows);
  // Seats name a client window by its app id and a browser window by its own
  // id. A page with no title goes by its address.
  const title = (appId: string): string => {
    const client = titled.find((window) => window.appId === appId);
    if (client !== undefined) {
      return client.title;
    }
    const page = pages?.find((window) => window.id === appId);
    if (page === undefined) {
      return "";
    }
    return page.title === "" ? page.url : page.title;
  };
  const uses = (agent: Agent): readonly Use[] => {
    const seat = list?.find(({ id }) => id === seatId(agent));
    return seat === undefined
      ? []
      : [
          ...seat.holds
            .filter((appId) => !seat.taken.includes(appId))
            .map((appId) => ({
              appId,
              how: howHeld(seat, appId),
              title: title(appId),
            })),
          ...seat.taken.map((appId) => ({
            appId,
            how: "taken" as const,
            title: title(appId),
          })),
        ];
  };
  return {
    uses,
  };
};

/** The seat id the compositor gives `agent`'s session. */
const seatId = (agent: Agent): string => `agent-${String(agent.id)}`;

/** Whether `seat` types in or points at window `appId`, which it holds. */
const howHeld = (seat: Seat, appId: string): How =>
  seat.focused === appId ? "typing" : "pointing";

/** The agent sessions in control, never none. */
type Sessions = readonly [Agent, ...Agent[]];

type Controls = {
  change: (agent: Agent) => void;
  /** Lets agents drive window `appId` again. */
  giveBack: (appId: string) => void;
  stop: (agent: Agent) => void;
  /** Takes window `appId` from the agent using it. */
  takeOver: (appId: string) => void;
  /** The windows `agent` uses. */
  uses: (agent: Agent) => readonly Use[];
};

/**
 * The one pill, and its panel. Amber, and "Paused", while the user has taken
 * any window from an agent. The taken window's own banner says so and gives
 * it back, so the pill drops no notice over it.
 */
const Pill = ({ agents, ...controls }: Controls & { agents: Sessions }) => {
  const [first] = agents;
  const names = new Set(agents.map((agent) => agent.agent));
  const label = names.size === 1 ? first.agent : "Agents";
  const several = agents.length > 1 ? sessionsName(agents, names) : undefined;
  const paused = agents.some((agent) =>
    controls.uses(agent).some(({ how }) => how === "taken"),
  );
  const [open, setOpen] = useState(false);
  return (
    <Popover
      align="center"
      onOpenChange={setOpen}
      open={open}
      side="bottom"
      tone="overPhoto"
      tooltip={
        several === undefined
          ? `${first.agent} can see and use ${reach(first)}`
          : `${several} are in control`
      }
      trigger={
        <button
          aria-label={several}
          className={triggerStyles}
          data-paused={paused ? "" : undefined}
          type="button"
        >
          {paused ? (
            <PauseIcon aria-hidden size={15} weight="fill" />
          ) : (
            <RobotIcon aria-hidden size={15} weight="bold" />
          )}
          {paused ? `${label} · Paused` : label}
          {several !== undefined && (
            <span className={countStyles}>{agents.length}</span>
          )}
        </button>
      }
    >
      <Panels agents={agents} several={several} {...controls} />
    </Popover>
  );
};

/** One session's panel, or several sessions' with `several` naming them. */
const Panels = ({
  agents,
  several,
  ...controls
}: Controls & { agents: Sessions; several: string | undefined }) =>
  several === undefined ? (
    <Panel agent={agents[0]} {...controls} />
  ) : (
    <SessionsPanel
      agents={agents}
      {...controls}
      title={`${several} are in control`}
    />
  );

/** One session's panel. */
const Panel = ({
  agent,
  change,
  stop,
  ...using
}: Controls & { agent: Agent }) => {
  const now = useNow();
  return (
    <div className={panelStyles}>
      <span className={headStyles}>
        <strong>{`${agent.agent} is in control`}</strong>
        <span className={detailStyles}>
          {`It can see and use ${reach(agent)}.`}
        </span>
      </span>
      <Using agent={agent} {...using} />
      <Actions agent={agent} now={now} />
      <Buttons agent={agent} change={change} stop={stop} />
    </div>
  );
};

/** Several sessions' panel: each with its own buttons, then Stop all. */
const SessionsPanel = ({
  agents,
  change,
  stop,
  title,
  ...using
}: Controls & { agents: Sessions; title: string }) => {
  const now = useNow();
  return (
    <div className={panelStyles}>
      <strong>{title}</strong>
      {agents.map((agent) => (
        <section
          aria-label={agent.agent}
          className={sessionStyles}
          key={agent.id}
        >
          <span className={headStyles}>
            <strong>{agent.agent}</strong>
            <span className={detailStyles}>
              {`Can see and use ${reach(agent)}.`}
            </span>
          </span>
          <Using agent={agent} {...using} />
          <Actions agent={agent} now={now} />
          <Buttons agent={agent} change={change} quiet stop={stop} />
        </section>
      ))}
      <span className={buttonsStyles}>
        <Button
          beforeIcon={<StopIcon aria-hidden weight="fill" />}
          onClick={() => {
            for (const agent of agents) {
              stop(agent);
            }
          }}
          size="sm"
          variant="danger"
        >
          Stop all
        </Button>
      </span>
    </div>
  );
};

/**
 * The windows `agent` uses now, each with a button that takes it over, then
 * the windows the user took from it, each with one that gives it back.
 */
const Using = ({
  agent,
  giveBack,
  takeOver,
  uses,
}: Pick<Controls, "giveBack" | "takeOver" | "uses"> & { agent: Agent }) => {
  const used = uses(agent);
  return (
    used.length > 0 && (
      <ul aria-label={`What ${agent.agent} is using`} className={actionsStyles}>
        {used.map(({ appId, how, title }) => {
          const name = title === "" ? "an untitled window" : title;
          return (
            <li className={actionStyles} key={appId}>
              <span className={useStyles}>
                <span className={saidStyles}>
                  {title === "" ? "Untitled window" : title}
                </span>
                <span className={whenStyles}>{HOW[how]}</span>
              </span>
              <span className={buttonStyles}>
                {how === "taken" ? (
                  <Button
                    label={`Give ${name} back`}
                    onClick={() => {
                      giveBack(appId);
                    }}
                    size="sm"
                    variant="outline"
                  >
                    Give back
                  </Button>
                ) : (
                  <Button
                    label={`Take over ${name}`}
                    onClick={() => {
                      takeOver(appId);
                    }}
                    size="sm"
                    variant="outline"
                  >
                    Take over
                  </Button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    )
  );
};

/** What a row of {@link Using} says the agent does in its window. */
const HOW: Readonly<Record<How, string>> = {
  pointing: "Pointing",
  taken: "Paused: you're using it",
  typing: "Typing",
};

/** What `agent` did last, if anything. */
const Actions = ({ agent, now }: { agent: Agent; now: number }) =>
  agent.actions.length > 0 && (
    <ul aria-label={`What ${agent.agent} did`} className={actionsStyles}>
      {agent.actions.map((action) => (
        <li
          className={actionStyles}
          key={`${String(action.atMs)}:${action.said}`}
        >
          <span className={saidStyles}>{action.said}</span>
          <time
            className={whenStyles}
            dateTime={new Date(action.atMs).toISOString()}
          >
            {ago(action.atMs, now)}
          </time>
        </li>
      ))}
    </ul>
  );

/** Change and Stop; `quiet` draws Stop without a fill, for one among several. */
const Buttons = ({
  agent,
  change,
  quiet = false,
  stop,
}: Pick<Controls, "change" | "stop"> & { agent: Agent; quiet?: boolean }) => (
  <span className={buttonsStyles}>
    <Button
      beforeIcon={<SlidersHorizontalIcon aria-hidden />}
      onClick={() => {
        change(agent);
      }}
      size="sm"
      variant="outline"
    >
      Change
    </Button>
    <Button
      beforeIcon={<StopIcon aria-hidden weight="fill" />}
      onClick={() => {
        stop(agent);
      }}
      size="sm"
      variant={quiet ? "dangerGhost" : "danger"}
    >
      Stop
    </Button>
  </span>
);

/** Several sessions, named once: "2 Claude Code sessions" or "3 agents". */
const sessionsName = (agents: Sessions, names: ReadonlySet<string>): string =>
  names.size === 1
    ? `${String(agents.length)} ${agents[0].agent} sessions`
    : `${String(agents.length)} agents`;

const isAgent = (session: Capturing): session is Agent =>
  session.kind === CapturingKind.Agent;

/** What an agent reaches, after "can see and use". */
const reach = (agent: Agent): string =>
  agent.reach.kind === "desk"
    ? "your whole desktop"
    : LIST.format(
        agent.reach.windows.map((window) =>
          window.title === "" ? "an untitled window" : window.title,
        ),
      );

/** How long ago `time` was at `now`, both epoch milliseconds. */
export const ago = (time: number, now: number): string => {
  const since = now - time;
  if (since < MINUTE_MS) {
    return "just now";
  } else if (since < HOUR_MS) {
    return `${String(Math.floor(since / MINUTE_MS))} min ago`;
  } else {
    return `${String(Math.floor(since / HOUR_MS))} hr ago`;
  }
};

/** The time now, moving on every {@link TICK_MS}. */
const useNow = (): number => {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const ticking = setInterval(() => {
      setNow(Date.now());
    }, TICK_MS);
    return () => {
      clearInterval(ticking);
    };
  }, []);
  return now;
};

// The agent's violet, so it reads apart from the red sharing pill and as
// the same agent as its rings and pointer.
const triggerStyles = hstack({
  _hover: {
    backgroundColor: "color-mix(in oklab, {colors.agent} 85%, black)",
  },
  "&[data-paused]": {
    _hover: {
      backgroundColor: "color-mix(in oklab, {colors.agentPaused} 85%, black)",
    },
    backgroundColor: "agentPaused",
  },
  backgroundColor: "agent",
  blockSize: 6,
  borderRadius: "lg",
  borderStyle: "none",
  color: "onAgent",
  cursor: "pointer",
  flexShrink: 0,
  fontSize: "sm",
  fontWeight: "semibold",
  gap: 1.5,
  paddingInline: 2.5,
  textShadow: "none",
  transition: "background-color {durations.fast} {easings.default}",
  whiteSpace: "nowrap",
});

// How many sessions, on the pill.
const countStyles = center({
  backgroundColor: "color-mix(in oklab, currentcolor 24%, transparent)",
  blockSize: 4,
  borderRadius: "full",
  fontSize: "xs",
  inline: true,
  minInlineSize: 4,
  paddingInline: 1,
});

const panelStyles = flex({
  direction: "column",
  gap: 3,
  inlineSize: 72,
  paddingBlock: 1.5,
});

const headStyles = flex({ direction: "column", gap: 0.5 });

// A rule above each session, so they read apart.
const sessionStyles = flex({
  borderBlockStart:
    "1px solid color-mix(in oklab, currentcolor 15%, transparent)",
  direction: "column",
  gap: 3,
  paddingBlockStart: 3,
});

// At the panel's end, sized to their labels.
const buttonsStyles = hstack({ gap: 2, justifyContent: "flex-end" });

const detailStyles = css({ fontSize: "xs", opacity: 0.75 });

const actionsStyles = flex({
  backgroundColor: "color-mix(in oklab, currentcolor 8%, transparent)",
  borderRadius: "lg",
  direction: "column",
  listStyle: "none",
  margin: 0,
  padding: 1,
});

const actionStyles = hstack({
  fontSize: "sm",
  gap: 3,
  justifyContent: "space-between",
  padding: 1.5,
});

const saidStyles = css({
  minInlineSize: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

// A row's button keeps its label's width beside a long window title.
const buttonStyles = css({ flexShrink: 0 });

// A window's name over what the agent does in it.
const useStyles = flex({ direction: "column", minInlineSize: 0 });

const whenStyles = css({ flexShrink: 0, fontSize: "xs", opacity: 0.75 });
