import { Button } from "@domicile-desktop/component-library/Button";
import { Card } from "@domicile-desktop/component-library/Card";

import { css } from "../../styled-system/css";
import type { Report } from "../config-editor";
import type { AgentReach, KnownAgents, SettingsHost } from "../host";
import { Notice } from "../Notice";
import { Page } from "../Page";
import { SettingRow } from "../SettingRow";
import { useAgents } from "../useAgents";

type Props = {
  title: string;
  description: string;
  host: SettingsHost;
  report: Report;
};

const LIST = new Intl.ListFormat("en", { type: "conjunction" });

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Each agent connected now or remembered: what it reaches, with Stop for one
 * connected and Forget for one remembered, which makes it ask again.
 */
export const AgentsPage = ({ description, host, report, title }: Props) => {
  const { agents, failure, forget, stop } = useAgents(host, report);
  return (
    <Page description={description} title={title}>
      {failure !== undefined && (
        <Notice tone="danger">
          Couldn't list agents:{" "}
          {failure instanceof Error ? failure.message : String(failure)}
        </Notice>
      )}
      {agents !== undefined && (
        <Card>
          {rows(agents).length === 0 ? (
            <p className={hintStyles}>
              No agent is connected or remembered. An agent asks the first time
              it uses your desktop.
            </p>
          ) : (
            <div>
              {rows(agents).map((row) => (
                <SettingRow
                  hint={said(row, Date.now())}
                  key={row.agent}
                  title={row.agent}
                >
                  {row.remembered !== undefined && (
                    <Button
                      label={`Forget ${row.agent}`}
                      onClick={() => {
                        forget(row.agent);
                      }}
                      size="sm"
                      variant="outline"
                    >
                      Forget
                    </Button>
                  )}
                  {row.sessions.length > 0 && (
                    <Button
                      label={`Stop ${row.agent}`}
                      onClick={() => {
                        for (const { session } of row.sessions) {
                          stop(session, row.agent);
                        }
                      }}
                      size="sm"
                      variant="danger"
                    >
                      Stop
                    </Button>
                  )}
                </SettingRow>
              ))}
            </div>
          )}
        </Card>
      )}
    </Page>
  );
};

/** One agent by name: each of its sessions, and whether it is remembered. */
type Row = {
  agent: string;
  sessions: KnownAgents["connected"];
  /** When it was last let in, if remembered. */
  remembered: number | undefined;
};

/** Connected agents first, oldest first, then the rest remembered. */
export const rows = (agents: KnownAgents): Row[] => {
  const byName = new Map<string, Row>();
  for (const connected of agents.connected) {
    const row = byName.get(connected.agent) ?? {
      agent: connected.agent,
      remembered: undefined,
      sessions: [],
    };
    byName.set(connected.agent, {
      ...row,
      sessions: [...row.sessions, connected],
    });
  }
  for (const { agent, lastUsedMs } of agents.remembered) {
    const row = byName.get(agent) ?? {
      agent,
      remembered: undefined,
      sessions: [],
    };
    byName.set(agent, { ...row, remembered: lastUsedMs });
  }
  return [...byName.values()];
};

/** What a row says under its name, at `now`. */
export const said = (row: Row, now: number): string =>
  [
    ...(row.sessions.length > 0
      ? ["Connected now", reaches(row.sessions.map(({ reach }) => reach))]
      : []),
    ...(row.remembered === undefined
      ? []
      : [
          "Remembered",
          ...(row.sessions.length > 0 ? [] : ["Your whole desktop"]),
          `Last used ${lastUsed(row.remembered, now)}`,
        ]),
  ].join(" · ");

/** What its sessions reach, together. */
const reaches = (reach: readonly AgentReach[]): string =>
  reach.some(({ type }) => type === "desk")
    ? "Your whole desktop"
    : LIST.format(
        reach.flatMap((each) =>
          each.type === "windows"
            ? each.windows.map(({ title }) =>
                title === "" ? "an untitled window" : title,
              )
            : [],
        ),
      );

/** When `time` was, in days, at `now`. */
export const lastUsed = (time: number, now: number): string => {
  const days =
    Math.floor(startOfDay(now) / DAY_MS) -
    Math.floor(startOfDay(time) / DAY_MS);
  if (days <= 0) {
    return "today";
  } else if (days === 1) {
    return "yesterday";
  } else {
    return `${String(days)} days ago`;
  }
};

/** The local midnight before `time`, as a count of milliseconds. */
const startOfDay = (time: number): number => {
  const day = new Date(time);
  day.setHours(0, 0, 0, 0);
  return day.getTime() - day.getTimezoneOffset() * 60 * 1000;
};

const hintStyles = css({ color: "muted", fontSize: "xs", margin: 0 });
