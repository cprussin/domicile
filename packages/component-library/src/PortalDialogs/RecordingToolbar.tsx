import type { Capturing, CapturingKind } from "@domicile-desktop/sdk/portal";
import { hideFromCaptures } from "@domicile-desktop/sdk/portal";
import { PauseIcon } from "@phosphor-icons/react/dist/ssr/Pause";
import { PlayIcon } from "@phosphor-icons/react/dist/ssr/Play";
import { StopIcon } from "@phosphor-icons/react/dist/ssr/Stop";
import { TrashIcon } from "@phosphor-icons/react/dist/ssr/Trash";
import { useEffect, useRef, useState } from "react";
import { css } from "../../styled-system/css";
import { hstack } from "../../styled-system/patterns";
import { Button } from "../Button/Button";
import { useScreenRegion } from "../Screen/DisplayProvider";

/** The shell's own screen recording. */
export type Recording = Extract<Capturing, { kind: CapturingKind.Recording }>;

type Props = {
  recording: Recording;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  discard: () => void;
  screen: string | undefined;
};

/**
 * A floating toolbar over the bottom of the screen while the shell records:
 * how long it has recorded, and buttons that pause or resume, stop and
 * discard it. It shows on screen and is left out of the recording, and of
 * every other capture of the desk.
 */
export const RecordingToolbar = ({
  discard,
  pause,
  recording,
  resume,
  screen,
  stop,
}: Props) => {
  const region = useScreenRegion(screen);
  const toolbar = useRef<HTMLDivElement>(null);
  const paused = recording.runningSinceMs === undefined;
  const elapsed = useElapsed(recording);

  useEffect(() => {
    if (toolbar.current === null) {
      throw new Error("the recording toolbar is not drawn");
    }
    hideFromCaptures(toolbar.current).catch((error: unknown) => {
      // biome-ignore lint/suspicious/noConsole: the toolbar would show in the recording
      console.error(
        "Failed to hide the recording toolbar from captures",
        error,
      );
    });
  }, []);

  return (
    <div className={regionStyles} style={region}>
      <div
        aria-label="Screen recording"
        className={toolbarStyles}
        ref={toolbar}
        role="toolbar"
      >
        <span
          aria-hidden
          className={css(dotStyles, paused ? pausedDotStyles : liveDotStyles)}
        />
        <span className={stateStyles}>{paused ? "Paused" : "Recording"}</span>
        <span
          aria-label={paused ? "Paused at" : "Recorded"}
          className={timerStyles}
          role="timer"
        >
          {clock(elapsed)}
        </span>
        <Button
          beforeIcon={
            paused ? <PlayIcon weight="fill" /> : <PauseIcon weight="fill" />
          }
          onClick={paused ? resume : pause}
          rounded
          size="lg"
          variant="primary"
        >
          {paused ? "Resume" : "Pause"}
        </Button>
        <Button
          beforeIcon={<StopIcon weight="fill" />}
          onClick={stop}
          rounded
          size="lg"
          variant="danger"
        >
          Stop
        </Button>
        <Button
          label="Discard"
          onClick={discard}
          rounded
          size="lg"
          variant="ghost"
        >
          <TrashIcon />
        </Button>
      </div>
    </div>
  );
};

/** How long `recording` has recorded, in milliseconds, kept up to date. */
const useElapsed = (recording: Recording): number => {
  const [now, setNow] = useState(Date.now);
  const { recordedMs, runningSinceMs } = recording;
  useEffect(() => {
    if (runningSinceMs === undefined) {
      return;
    }
    setNow(Date.now());
    const ticking = setInterval(() => {
      setNow(Date.now());
    }, TICK_MS);
    return () => {
      clearInterval(ticking);
    };
  }, [runningSinceMs]);
  return runningSinceMs === undefined
    ? recordedMs
    : recordedMs + Math.max(0, now - runningSinceMs);
};

/** Often enough that the seconds never lag by more than this. */
const TICK_MS = 250;

/** `ms` as minutes and seconds, or hours, minutes and seconds past an hour. */
export const clock = (ms: number): string => {
  const seconds = Math.floor(ms / 1000);
  const [hours, minutes] = [
    Math.floor(seconds / 3600),
    Math.floor(seconds / 60) % 60,
  ];
  const ss = String(seconds % 60).padStart(2, "0");
  return hours > 0
    ? `${String(hours)}:${String(minutes).padStart(2, "0")}:${ss}`
    : `${String(minutes)}:${ss}`;
};

// Spans the screen so the toolbar can sit at its foot; takes no clicks
// itself.
const regionStyles = css({
  inset: 0,
  pointerEvents: "none",
  position: "fixed",
  zIndex: "toast",
});

// Its own stacking context and group, or Element Capture will not leave it
// out.
const toolbarStyles = hstack({
  backgroundColor: "card",
  border: "1px solid {colors.border}",
  borderRadius: "full",
  boxShadow: "{shadows.lifted}",
  color: "foreground",
  fontSize: "lg",
  fontVariantNumeric: "tabular-nums",
  gap: 3,
  insetBlockEnd: 10,
  insetInlineStart: "50%",
  isolation: "isolate",
  paddingBlock: 2,
  paddingInline: 2,
  paddingInlineStart: 5,
  pointerEvents: "auto",
  position: "absolute",
  transform: "translateX(-50%)",
});

const dotStyles = css.raw({
  backgroundColor: "danger",
  blockSize: 3.5,
  borderRadius: "full",
  flexShrink: 0,
  inlineSize: 3.5,
  position: "relative",
});

// A ring spreads out from the dot while it records, like `Loading`'s radar.
const liveDotStyles = css.raw({
  _after: {
    animation: "ping {durations.ping} {easings.out} infinite",
    border: "{spacing.0.5} solid {colors.danger}",
    borderRadius: "full",
    content: '""',
    inset: 0,
    opacity: 0,
    position: "absolute",
  },
});

const pausedDotStyles = css.raw({ backgroundColor: "muted" });

const stateStyles = css({ fontWeight: "semibold" });

const timerStyles = css({ color: "textSoft", minInlineSize: "5ch" });
