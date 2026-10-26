import { useBar } from "@domicile-desktop/manganese-bar/bar-context";
import { useDomicile } from "@domicile-desktop/react/domicile-provider";
import {
  deskSound,
  deskSoundHardware,
} from "@domicile-desktop/system-audio/react";
import { Volume as Control } from "./Volume";

/**
 * The volume control, whose panel holds the mixer, or only the output while
 * locked.
 */
export const Volume = () => {
  const domicile = useDomicile();
  const { audio, sound } = deskSound(domicile);
  const { locked } = useBar();
  return (
    <Control
      audio={audio}
      hardware={deskSoundHardware(domicile)}
      locked={locked}
      server={sound}
    />
  );
};
