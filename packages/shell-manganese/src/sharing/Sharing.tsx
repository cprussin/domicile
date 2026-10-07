import { Button } from "@domicile-desktop/component-library/Button";
import { Popover } from "@domicile-desktop/component-library/Popover";
import { sourceName } from "@domicile-desktop/component-library/source-name";
import type { App } from "@domicile-desktop/component-library/useApps";
import { useApps } from "@domicile-desktop/component-library/useApps";
import type {
  Captured,
  Capturing,
  PortalHost,
} from "@domicile-desktop/sdk/portal";
import {
  CapturedKind,
  CapturingKind,
  stopCapturing,
  watchCapturing,
} from "@domicile-desktop/sdk/portal";
import type { System } from "@domicile-desktop/sdk/system";
import { ScreencastIcon } from "@phosphor-icons/react/dist/ssr/Screencast";
import { useEffect, useState } from "react";

import { css } from "../../styled-system/css";

type Props = {
  /** The desktop whose captures to show. */
  host: PortalHost;
  /** How it reads applications' desktop entries. */
  system: System;
};

/** A running screen cast. */
type ScreenCast = Extract<Capturing, { kind: CapturingKind.ScreenCast }>;

/**
 * Top bar sharing indicator: shown while an application records the desktop
 * through the ScreenCast portal. Its panel lists who records what, each with
 * a button that stops it. Input sessions are left to `<PortalDialogs />`.
 */
export const Sharing = ({ host, system }: Props) => {
  const [capturing, setCapturing] = useState<readonly ScreenCast[]>([]);
  const apps = useApps(
    system,
    capturing.map((capture) => capture.appId),
  );

  useEffect(
    () =>
      watchCapturing(host, (sessions) => {
        setCapturing(sessions.filter((session) => isScreenCast(session)));
      }),
    [host],
  );

  return capturing.length === 0 ? undefined : (
    <Popover
      align="center"
      side="bottom"
      tone="overPhoto"
      trigger={
        <button
          aria-label={triggerLabel(apps, capturing)}
          className={triggerStyles}
          type="button"
        >
          <ScreencastIcon size={15} weight="bold" />
        </button>
      }
    >
      <ul className={listStyles}>
        {capturing.map((capture) => (
          <li className={captureStyles} key={capture.id}>
            <Who app={apps(capture.appId)} />
            <ul className={sourcesStyles}>
              {capture.sources.map((source) => (
                <li key={sourceKey(source)}>{sourceName(source)}</li>
              ))}
            </ul>
            <Button
              onClick={() => {
                stopCapturing(host, capture.id);
              }}
              size="sm"
              variant="danger"
            >
              Stop sharing
            </Button>
          </li>
        ))}
      </ul>
    </Popover>
  );
};

/** The recording application's icon, when it has one, and name. */
const Who = ({ app }: { app: App }) => (
  <span className={whoStyles}>
    {app.icon !== undefined && (
      <img alt="" className={iconStyles} src={app.icon} />
    )}
    {app.name}
  </span>
);

const triggerLabel = (
  apps: (appId: string) => App,
  capturing: readonly ScreenCast[],
): string => {
  const [only] = capturing;
  return capturing.length === 1 && only !== undefined
    ? `${apps(only.appId).name} is sharing`
    : `${capturing.length} applications are sharing`;
};

const isScreenCast = (session: Capturing): session is ScreenCast =>
  session.kind === CapturingKind.ScreenCast;

const sourceKey = (source: Captured): string => {
  switch (source.kind) {
    case CapturedKind.Window:
      return `window:${source.id}`;
    case CapturedKind.Monitor:
      return `monitor:${source.name}`;
    case CapturedKind.Region:
      return `region:${source.position.join(",")}:${source.size.join("x")}`;
  }
};

// Matches the volume item's button, in the warning color so it stands out.
const triggerStyles = css({
  _hover: {
    backgroundColor: "color-mix(in oklab, white 16%, transparent)",
  },
  alignItems: "center",
  backgroundColor: "transparent",
  blockSize: 7,
  borderRadius: "full",
  borderStyle: "none",
  color: "warning",
  cursor: "pointer",
  display: "inline-flex",
  flexShrink: 0,
  inlineSize: 7,
  justifyContent: "center",
  padding: 0,
  transition: "background-color {durations.fast} {easings.default}",
});

const listStyles = css({
  display: "flex",
  flexDirection: "column",
  gap: 3,
  listStyle: "none",
  margin: 0,
  padding: 0,
});

const captureStyles = css({
  alignItems: "start",
  display: "flex",
  flexDirection: "column",
  gap: 1,
});

const whoStyles = css({
  alignItems: "center",
  display: "flex",
  fontWeight: "semibold",
  gap: 2,
});

const iconStyles = css({ blockSize: 4, flexShrink: 0, inlineSize: 4 });

const sourcesStyles = css({
  fontSize: "sm",
  margin: 0,
  paddingInlineStart: 4,
});
