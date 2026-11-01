import { WarningCircleIcon } from "@phosphor-icons/react/dist/ssr/WarningCircle";
import type { ReactNode } from "react";

import { cva } from "../../styled-system/css";
import "../stylesheet";

export const TONES = ["quiet", "warning"] as const;
export type Tone = (typeof TONES)[number];

type Props = {
  /** What it says, in plain words. */
  children: ReactNode;
  /**
   * The words behind it, such as a service's error, shown while the pointer
   * rests on it.
   */
  detail?: string | undefined;
  /** `warning` for a request that was refused. */
  tone?: Tone | undefined;
};

/**
 * One line on how a panel stands beside its rows, such as nothing else nearby,
 * or a request that failed. A panel with nothing at all to show takes an
 * `EmptyState`, and one still waiting a `Loading`. Announced as it changes.
 */
export const PanelNote = ({ children, detail, tone = "quiet" }: Props) => (
  <span
    className={noteStyles({ tone })}
    data-tone={tone}
    role="status"
    title={detail}
  >
    {tone === "warning" && (
      <WarningCircleIcon
        aria-label="Warning"
        role="img"
        size={14}
        weight="bold"
      />
    )}
    {children}
  </span>
);

const noteStyles = cva({
  base: {
    alignItems: "center",
    display: "flex",
    gap: 1.5,
    textStyle: "panelDetail",
  },
  variants: {
    tone: {
      quiet: { color: "textSoft" },
      warning: { color: "warning" },
    },
  },
});
