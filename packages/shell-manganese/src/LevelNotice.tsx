import { useScreenRegion } from "@domicile-desktop/component-library/DisplayProvider";
import { LevelToast } from "@domicile-desktop/component-library/LevelToast";
import { MicrophoneIcon } from "@phosphor-icons/react/dist/ssr/Microphone";
import { MicrophoneSlashIcon } from "@phosphor-icons/react/dist/ssr/MicrophoneSlash";
import { SpeakerHighIcon } from "@phosphor-icons/react/dist/ssr/SpeakerHigh";
import { SpeakerSlashIcon } from "@phosphor-icons/react/dist/ssr/SpeakerSlash";
import { SunIcon } from "@phosphor-icons/react/dist/ssr/Sun";
import { css } from "../styled-system/css";
import type { KeyLevel } from "./media-keys";
import { LevelKind } from "./media-keys";

/** A media key's level, and how many keys were pressed so far. */
export type LevelPress = { count: number; level: KeyLevel };

type Props = {
  /** The last press that changed a level; `undefined` before any. */
  press: LevelPress | undefined;
  /** The screen to show on: the one with the keyboard. */
  screen: string;
};

/**
 * A notice at the bottom of `screen` with the level a volume, microphone or
 * brightness key set. Presses while it is up update it in place.
 */
export const LevelNotice = ({ press, screen }: Props) =>
  press === undefined ? undefined : <Shown press={press} screen={screen} />;

const Shown = ({
  press: { count, level },
  screen,
}: Props & { press: LevelPress }) => {
  const region = useScreenRegion(screen);
  return (
    <div className={screenStyles} style={region}>
      <LevelToast
        changes={count}
        icon={<Icon level={level} />}
        label={NAMES[level.kind]}
        level={level.level}
        muted={level.muted}
      />
    </div>
  );
};

const NAMES: Record<LevelKind, string> = {
  [LevelKind.Brightness]: "Brightness",
  [LevelKind.Microphone]: "Microphone",
  [LevelKind.Volume]: "Volume",
};

const Icon = ({ level: { kind, muted } }: { level: KeyLevel }) => {
  switch (kind) {
    case LevelKind.Volume:
      return muted ? (
        <SpeakerSlashIcon size={28} weight="fill" />
      ) : (
        <SpeakerHighIcon size={28} weight="fill" />
      );
    case LevelKind.Microphone:
      return muted ? (
        <MicrophoneSlashIcon size={28} weight="fill" />
      ) : (
        <MicrophoneIcon size={28} weight="fill" />
      );
    case LevelKind.Brightness:
      return <SunIcon size={28} weight="fill" />;
  }
};

// The screen's box, over windows and under panels like the toasts. Ignores the
// pointer so windows under it stay clickable. The toast sits centered near
// its bottom edge.
const screenStyles = css({
  alignItems: "flex-end",
  display: "flex",
  justifyContent: "center",
  paddingBlockEnd: 20,
  pointerEvents: "none",
  position: "fixed",
  zIndex: "toast",
});
