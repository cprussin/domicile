import { useBar } from "@domicile-desktop/manganese-bar/bar-context";
import { useDomicile } from "@domicile-desktop/manganese-host/domicile-context";
import { deskSound, deskSoundHardware } from "./desk-sound";
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
