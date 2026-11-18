import { Button } from "@domicile-desktop/component-library/Button";
import { Popover } from "@domicile-desktop/component-library/Popover";
import type { Capturing, CapturingKind } from "@domicile-desktop/sdk/portal";
import { RobotIcon } from "@phosphor-icons/react/dist/ssr/Robot";
import { StopIcon } from "@phosphor-icons/react/dist/ssr/Stop";
import { useEffect, useState } from "react";

import { css } from "../styled-system/css";
import { flex, hstack } from "../styled-system/patterns";

/** An agent the user let in. */
export type Agent = Extract<Capturing, { kind: CapturingKind.Agent }>;

const LIST = new Intl.ListFormat("en", { type: "conjunction" });

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/** How often "1 min ago" moves on while the panel is open. */
const TICK_MS = 15 * 1000;

/**
 * A violet pill per agent in control, named as it names itself. Its panel
 * says what it can reach and what it did last, with a button that stops it.
 */
export const Agents = ({
  agents,
  stop,
}: {
  agents: readonly Agent[];
  stop: (id: number) => void;
}) =>
  agents.map((agent) => (
    <Popover
      align="center"
      key={agent.id}
      side="bottom"
      tone="overPhoto"
      tooltip={`${agent.agent} can see and use ${reach(agent)}`}
      trigger={
        <button className={triggerStyles} type="button">
          <RobotIcon aria-hidden size={15} weight="bold" />
          {agent.agent}
        </button>
      }
    >
      <Panel
        agent={agent}
        stop={() => {
          stop(agent.id);
        }}
      />
    </Popover>
  ));

const Panel = ({ agent, stop }: { agent: Agent; stop: () => void }) => {
  const now = useNow();
  return (
    <div className={panelStyles}>
      <span className={headStyles}>
        <strong>{`${agent.agent} is in control`}</strong>
        <span className={detailStyles}>
          {`It can see and use ${reach(agent)}.`}
        </span>
      </span>
      {agent.actions.length > 0 && (
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
      )}
      <Button
        beforeIcon={<StopIcon aria-hidden weight="fill" />}
        onClick={stop}
        size="sm"
        variant="danger"
      >
        Stop
      </Button>
    </div>
  );
};

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

// Violet, beside the red sharing pill, so the two read apart.
const triggerStyles = hstack({
  _hover: {
    backgroundColor: "color-mix(in oklab, {colors.violet.600} 85%, black)",
  },
  backgroundColor: "violet.600",
  blockSize: 6,
  borderRadius: "lg",
  borderStyle: "none",
  color: "onPhoto",
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

const panelStyles = flex({
  direction: "column",
  gap: 3,
  inlineSize: 72,
  paddingBlock: 1.5,
});

const headStyles = flex({ direction: "column", gap: 0.5 });

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

const whenStyles = css({ flexShrink: 0, fontSize: "xs", opacity: 0.75 });
