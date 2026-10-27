import { useDomicile } from "@domicile-desktop/react/domicile-provider";
import { useSharedWatch } from "@domicile-desktop/react/use-shared-watch";
import {
  deskSound,
  deskSoundHardware,
} from "@domicile-desktop/system-audio/react";

import { Mixer } from "./Mixer";
import { SoundGlyph, SoundRow, useSoundGestures } from "./SoundQuick";

/** The desk's speaker, for the quick settings button. */
export const SoundIndicator = () => {
  const domicile = useDomicile();
  return (
    <SoundGlyph
      audio={deskSound(domicile).audio}
      hardware={deskSoundHardware(domicile)}
    />
  );
};

/** The wheel and middle click on the desk's default output. */
export const useDeskSoundGestures = () => {
  const { audio, sound } = deskSound(useDomicile());
  return useSoundGestures(audio, sound);
};

/** The desk's volume slider, for the quick settings panel. */
export const SoundLevel = ({
  onMore,
}: {
  onMore?: (() => void) | undefined;
}) => {
  const { audio, sound } = deskSound(useDomicile());
  return <SoundRow audio={audio} onMore={onMore} server={sound} />;
};

/** The desk's mixer, for the quick settings panel's sound details. */
export const SoundMixer = () => {
  const { audio, sound } = deskSound(useDomicile());
  const reading = useSharedWatch(audio);
  return reading === undefined ? undefined : (
    <Mixer audio={reading} server={sound} />
  );
};
