import type { Captured, Capturing } from "@domicile-desktop/sdk/portal";
import { CapturedKind, CapturingKind } from "@domicile-desktop/sdk/portal";
import { css } from "../../styled-system/css";
import { flex, hstack } from "../../styled-system/patterns";
import { Button } from "../Button/Button";
import { useScreenRegion } from "../Screen/DisplayProvider";
import { appName } from "./app-name";
import { deviceNames } from "./device-names";

type Props = {
  sessions: readonly Capturing[];
  stop: (id: number) => void;
  screen: string | undefined;
};

/**
 * A row per session that records the screen or controls or captures input,
 * naming its application and what it holds, with a button that ends it.
 */
export const CapturingIndicator = ({ screen, sessions, stop }: Props) => {
  const region = useScreenRegion(screen);
  return sessions.length === 0 ? undefined : (
    <div className={regionStyles} style={region}>
      <ul aria-label="Sharing and remote control" className={listStyles}>
        {sessions.map((session) => (
          <li className={itemStyles} key={session.id}>
            <span>{summary(session)}</span>
            <Button
              onClick={() => {
                stop(session.id);
              }}
              size="sm"
              variant="outline"
            >
              Stop
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
};

// Spans the screen so the list can center on it; takes no clicks itself.
const regionStyles = css({
  inset: 0,
  pointerEvents: "none",
  position: "fixed",
  zIndex: "toast",
});

const listStyles = flex({
  direction: "column",
  gap: 1,
  inlineSize: "fit-content",
  insetBlockStart: 2,
  insetInline: 0,
  listStyle: "none",
  margin: 0,
  marginInline: "auto",
  padding: 0,
  position: "absolute",
});

const itemStyles = hstack({
  backgroundColor: "card",
  border: "1px solid {colors.warning}",
  borderRadius: "full",
  boxShadow: "{shadows.lifted}",
  color: "foreground",
  fontSize: "sm",
  gap: 3,
  paddingBlock: 1,
  paddingInlineEnd: 1,
  paddingInlineStart: 4,
  pointerEvents: "auto",
});

/** What a session's row says. */
const summary = (session: Capturing): string => {
  const name = appName(session.appId);
  switch (session.kind) {
    case CapturingKind.RemoteDesktop:
      return `Remote control: ${name} — ${[
        ...deviceNames(session.devices),
        ...(session.clipboard ? ["clipboard"] : []),
      ].join(", ")}`;
    case CapturingKind.InputCapture:
      return `Input capture: ${name} — ${deviceNames(session.devices).join(", ")}`;
    case CapturingKind.ScreenCast:
      return `Sharing: ${name} — ${session.sources.map((source) => sourceName(source)).join(", ")}`;
    case CapturingKind.Unknown:
      return `${session.wireKind}: ${name}`;
  }
};

/** How a row names a recorded source. */
const sourceName = (source: Captured): string => {
  switch (source.kind) {
    case CapturedKind.Window:
      return source.title === "" ? "Untitled window" : source.title;
    case CapturedKind.Monitor:
      return `Screen ${source.name}`;
    case CapturedKind.Region:
      return "Region";
  }
};
