import type { ReactNode } from "react";

import { css } from "../styled-system/css";
import { center, vstack } from "../styled-system/patterns";

type Props = {
  /** Below the text, such as a button that clears the search. */
  action?: ReactNode | undefined;
  children: ReactNode;
  /** A Phosphor icon, drawn large on a glowing disc. */
  icon: ReactNode;
  title: string;
  tone?: "accent" | "danger" | undefined;
};

/** A picture and a few words where the list would be. */
export const EmptyState = ({
  action,
  children,
  icon,
  title,
  tone = "accent",
}: Props) => (
  <div className={rootStyles} data-tone={tone}>
    <div aria-hidden className={pictureStyles}>
      <span className={ringStyles} />
      <span className={discStyles}>{icon}</span>
    </div>
    <h2 className={titleStyles}>{title}</h2>
    <p className={bodyStyles}>{children}</p>
    {action}
  </div>
);

const rootStyles = vstack({
  "--tone": "{colors.accent}",
  "&[data-tone=danger]": { "--tone": "{colors.danger}" },
  animation: "rise {durations.slowest} {easings.outQuart} backwards",
  gap: 3,
  paddingBlock: 20,
  paddingInline: 6,
  textAlign: "center",
});

const pictureStyles = center({
  animation: "hover {durations.hover} {easings.in-out} infinite",
  blockSize: 28,
  inlineSize: 28,
  marginBlockEnd: 4,
  position: "relative",
});

// A soft halo behind the disc.
const ringStyles = css({
  backgroundImage:
    "radial-gradient(circle, color-mix(in oklab, var(--tone) 35%, transparent), transparent 70%)",
  borderRadius: "full",
  filter: "blur({spacing.3})",
  inset: -6,
  position: "absolute",
});

const discStyles = center({
  backgroundImage:
    "linear-gradient(145deg, color-mix(in oklab, var(--tone) 30%, {colors.card}), color-mix(in oklab, var(--tone) 8%, {colors.background}))",
  blockSize: "100%",
  border: "1px solid color-mix(in oklab, var(--tone) 40%, transparent)",
  borderRadius: "full",
  boxShadow:
    "inset 0 1px 0 color-mix(in oklab, {colors.foreground} 14%, transparent), {shadows.lifted}",
  color: "color-mix(in oklab, var(--tone) 75%, {colors.foreground})",
  fontSize: "5xl",
  inlineSize: "100%",
  position: "relative",
});

const titleStyles = css({
  color: "foreground",
  fontSize: "xl",
  fontWeight: "semibold",
  letterSpacing: "tight",
  margin: 0,
});

const bodyStyles = css({
  color: "muted",
  fontSize: "sm",
  margin: 0,
  maxInlineSize: 96,
});
