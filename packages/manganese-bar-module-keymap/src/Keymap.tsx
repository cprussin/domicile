import {
  ChoiceList,
  RadioRow,
} from "@domicile-desktop/component-library/ChoiceRow";
import { Popover } from "@domicile-desktop/component-library/Popover";
import type { SharedWatch } from "@domicile-desktop/manganese-host/shared-watch";
import { useSharedWatch } from "@domicile-desktop/manganese-host/useSharedWatch";
import type { Keymaps } from "@domicile-desktop/sdk/keymap-choice";
import { KeyboardIcon } from "@phosphor-icons/react/dist/ssr/Keyboard";
import { useState } from "react";

import { css } from "../styled-system/css";

type Props = {
  /** The config's keymaps and the active one. */
  keymaps: SharedWatch<Keymaps>;
  /** Switches the desktop to the keymap named. */
  onSelect: (name: string) => void;
  /** Whether to show nothing while the first keymap, the default, is active. */
  hideDefault: boolean;
};

/**
 * The keymap the desktop types on, by name. A click lists every keymap to
 * switch to. Shows nothing for a keyboard with one keymap.
 */
export const Keymap = ({ hideDefault, keymaps, onSelect }: Props) => {
  const listed = useSharedWatch(keymaps);
  const [open, setOpen] = useState(false);
  if (listed === undefined || !shows(listed, hideDefault)) {
    return undefined;
  } else {
    const label = `Keymap: ${listed.active}`;
    return (
      <Popover
        align="center"
        onOpenChange={setOpen}
        open={open}
        side="bottom"
        tone="overPhoto"
        tooltip={label}
        trigger={
          <button aria-label={label} className={triggerStyles} type="button">
            <KeyboardIcon size={15} weight="bold" />
            {listed.active}
          </button>
        }
      >
        <ChoiceList<string>
          aria-label="Keymap"
          onValueChange={(name) => {
            onSelect(name);
            setOpen(false);
          }}
          value={listed.active}
        >
          {listed.keymaps.map(({ description, name }) => (
            <RadioRow
              detail={description}
              icon={<KeyboardIcon weight="duotone" />}
              key={name}
              name={name}
              value={name}
            />
          ))}
        </ChoiceList>
      </Popover>
    );
  }
};

/** Whether `listed` is worth showing. */
const shows = (listed: Keymaps, hideDefault: boolean): boolean =>
  listed.keymaps.length > 1 &&
  !(hideDefault && listed.active === listed.keymaps[0]?.name);

// Not the library's `Button`: its ghost variant uses `muted` text, which is
// unreadable over the wallpaper. Capitals, like the mode item, since the
// bar's text is always white.
const triggerStyles = css({
  _hover: {
    backgroundColor: "color-mix(in oklab, white 16%, transparent)",
  },
  alignItems: "center",
  backgroundColor: "transparent",
  blockSize: 7,
  borderRadius: "full",
  borderStyle: "none",
  color: "inherit",
  cursor: "pointer",
  display: "inline-flex",
  flexShrink: 0,
  fontSize: "0.625rem",
  fontWeight: "semibold",
  gap: 1,
  justifyContent: "center",
  minInlineSize: 7,
  paddingInline: 1.5,
  textTransform: "uppercase",
  transition: "background-color {durations.fast} {easings.default}",
});
