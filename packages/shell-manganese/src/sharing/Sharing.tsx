import { Button } from "@domicile-desktop/component-library/Button";
import { Popover } from "@domicile-desktop/component-library/Popover";
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
import { ScreencastIcon } from "@phosphor-icons/react/dist/ssr/Screencast";
import { useEffect, useState } from "react";

import { css } from "../../styled-system/css";

type Props = {
  /** The desktop whose captures to show. */
  host: PortalHost;
};

/** A running screen cast. */
type ScreenCast = Extract<Capturing, { kind: CapturingKind.ScreenCast }>;

/**
 * Top bar sharing indicator: shown while an application records the desktop
 * through the ScreenCast portal. Its panel lists who records what, each with
 * a button that stops it. Input sessions are left to `<PortalDialogs />`.
 */
export const Sharing = ({ host }: Props) => {
  const [capturing, setCapturing] = useState<readonly ScreenCast[]>([]);

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
          aria-label={triggerLabel(capturing)}
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
            <span className={whoStyles}>{appName(capture.appId)}</span>
            <ul className={sourcesStyles}>
              {capture.sources.map((source) => (
                <li key={source.id}>{sourceName(source)}</li>
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

const triggerLabel = (capturing: readonly ScreenCast[]): string => {
  const [only] = capturing;
  return capturing.length === 1 && only !== undefined
    ? `${appName(only.appId)} is sharing`
    : `${capturing.length} applications are sharing`;
};

const isScreenCast = (session: Capturing): session is ScreenCast =>
  session.kind === CapturingKind.ScreenCast;

const appName = (appId: string): string =>
  appId === "" ? "An application" : appId;

const sourceName = (source: Captured): string => {
  switch (source.kind) {
    case CapturedKind.Window:
      return source.title === "" ? "Untitled window" : source.title;
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

const whoStyles = css({ fontWeight: "semibold" });

const sourcesStyles = css({
  fontSize: "sm",
  margin: 0,
  paddingInlineStart: 4,
});
