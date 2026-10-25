import { ChoiceToast } from "@domicile-desktop/component-library/LevelToast";
import { KeyboardIcon } from "@phosphor-icons/react/dist/ssr/Keyboard";
import { ScreenNotice } from "./ScreenNotice";

/**
 * The keymap a `keymap` command switched to, with xkb's name for it if any,
 * and how many were run so far.
 */
export type KeymapPress = {
  count: number;
  description: string | undefined;
  keymap: string;
};

type Props = {
  /** The last switch; `undefined` before any. */
  press: KeymapPress | undefined;
  /** The screen to show on: the one with the keyboard. */
  screen: string;
};

/**
 * A notice at the bottom of `screen` with the keymap a `keymap` command
 * switched to. Switches while it is up update it in place.
 */
export const KeymapNotice = ({ press, screen }: Props) =>
  press === undefined ? undefined : (
    <ScreenNotice screen={screen}>
      <ChoiceToast
        changes={press.count}
        choice={press.keymap}
        detail={press.description}
        icon={<KeyboardIcon size={28} weight="fill" />}
        label="Keymap"
      />
    </ScreenNotice>
  );
