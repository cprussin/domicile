import { Button } from "@domicile/component-library/Button";
import type { DropPosition } from "@domicile/component-library/TabRail";
import { TabRail } from "@domicile/component-library/TabRail";
import { ThemeSwitch } from "@domicile/component-library/ThemeSwitch";
import { TerminalWindowIcon } from "@phosphor-icons/react/dist/ssr/TerminalWindow";

import { css } from "../../styled-system/css";
import { flex, hstack } from "../../styled-system/patterns";
import { Clock } from "../Clock";
import type { ShellWindow } from "./window";

/** A window with no tab selected — the rail's resting state on an empty shell. */
const NO_WINDOW = "";

type Props = {
  /**
   * The window the user is working in, which is not always the one on the
   * stage: a floating window is reached by its tab and has to look reached.
   */
  activeId: string | undefined;
  onClose: (id: string) => void;
  /** Open a browser window — what the rail's + does. */
  onNew: () => void;
  /** Launch a terminal onto the desktop — what the rail's footer does. */
  onOpenTerminal: () => void;
  onReorder: (fromId: string, toId: string, position: DropPosition) => void;
  onSelect: (id: string) => void;
  windows: readonly ShellWindow[];
};

/**
 * A tab per open window, beside the stage: the rail is what switches between
 * them, and the launchers, the theme toggle and the clock sit around it.
 */
export const WindowRail = ({
  activeId,
  onClose,
  onNew,
  onOpenTerminal,
  onReorder,
  onSelect,
  windows,
}: Props) => (
  // Its own element rather than the row around it, because that row is also
  // what the float chrome hangs inside and `opacity` multiplies: a bar inside a
  // faded ancestor cannot fade back in. A flex child that hugs the rail, so the
  // rail's own fixed width is still what decides the layout.
  <div className={wrapperStyles}>
    <TabRail
      activeId={activeId ?? NO_WINDOW}
      brand={<span className={brandStyles}>Domicile</span>}
      footer={
        <div className={footerStyles}>
          <Button
            label="Terminal"
            onClick={onOpenTerminal}
            size="sm"
            variant="ghost"
          >
            <TerminalWindowIcon size={18} />
          </Button>
          <ThemeSwitch />
          <Clock />
        </div>
      }
      onClose={onClose}
      onNew={onNew}
      onReorder={onReorder}
      onSelect={onSelect}
      tabs={windows.map((window) => ({
        id: window.id,
        label: window.title,
      }))}
    />
  </div>
);

const wrapperStyles = flex({ shrink: 0 });

const brandStyles = css({
  color: "foreground",
  fontSize: "sm",
  fontWeight: "semibold",
  letterSpacing: "wide",
});

const footerStyles = hstack({
  gap: 2,
  justify: "space-between",
});
