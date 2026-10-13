import { useBar } from "@domicile-desktop/manganese-bar/bar-context";
import { useDomicile } from "@domicile-desktop/manganese-host/domicile-context";
import { deskSound } from "./desk-sound";
import { Volume as Control } from "./Volume";

/**
 * The volume control, whose panel holds the mixer, or only the output while
 * locked.
 */
export const Volume = () => {
  const { audio, sound } = deskSound(useDomicile());
  const { locked } = useBar();
  return <Control audio={audio} locked={locked} server={sound} />;
};
