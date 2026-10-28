import { AnimatedMicrophoneIcon } from "@domicile-desktop/component-library/AnimatedMicrophoneIcon";
import { AnimatedSpeakerIcon } from "@domicile-desktop/component-library/AnimatedSpeakerIcon";
import { LevelToast } from "@domicile-desktop/component-library/LevelToast";
import { SunIcon } from "@phosphor-icons/react/dist/ssr/Sun";
import type { KeyLevel } from "./media-keys";
import { LevelKind } from "./media-keys";
import { ScreenNotice } from "./ScreenNotice";

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
  press === undefined ? undefined : (
    <ScreenNotice screen={screen}>
      <LevelToast
        changes={press.count}
        icon={<Icon level={press.level} />}
        label={NAMES[press.level.kind]}
        level={press.level.level}
        muted={press.level.muted}
      />
    </ScreenNotice>
  );

const NAMES: Record<LevelKind, string> = {
  [LevelKind.Brightness]: "Brightness",
  [LevelKind.Microphone]: "Microphone",
  [LevelKind.Volume]: "Volume",
};

const Icon = ({ level: { kind, level, muted } }: { level: KeyLevel }) => {
  switch (kind) {
    case LevelKind.Volume:
      return (
        <AnimatedSpeakerIcon
          muted={muted}
          size={28}
          volume={level}
          weight="fill"
        />
      );
    case LevelKind.Microphone:
      return <AnimatedMicrophoneIcon muted={muted} size={28} weight="fill" />;
    case LevelKind.Brightness:
      return <SunIcon size={28} weight="fill" />;
  }
};
