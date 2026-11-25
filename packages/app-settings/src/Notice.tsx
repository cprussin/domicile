import { InfoIcon } from "@phosphor-icons/react/dist/ssr/Info";
import { LockIcon } from "@phosphor-icons/react/dist/ssr/Lock";
import { WarningCircleIcon } from "@phosphor-icons/react/dist/ssr/WarningCircle";
import type { ReactNode } from "react";

import { cva } from "../styled-system/css";

type Props = {
  children: ReactNode;
  tone?: "info" | "locked" | "danger" | undefined;
};

/** A line above a page's settings: a note, why they are locked, or what failed. */
export const Notice = ({ children, tone = "info" }: Props) => (
  <p className={noticeStyles({ tone })} role="status">
    <NoticeIcon tone={tone} />
    <span>{children}</span>
  </p>
);

const NoticeIcon = ({ tone }: { tone: NonNullable<Props["tone"]> }) => {
  switch (tone) {
    case "danger":
      return <WarningCircleIcon size={18} weight="fill" />;
    case "info":
      return <InfoIcon size={18} weight="fill" />;
    case "locked":
      return (
        <LockIcon aria-label="Locked" role="img" size={18} weight="fill" />
      );
  }
};

const noticeStyles = cva({
  base: {
    "& svg": { flexShrink: 0, marginBlockStart: 0.5 },
    alignItems: "flex-start",
    border: "1px solid {colors.border}",
    borderRadius: "lg",
    display: "flex",
    fontSize: "sm",
    gap: 2.5,
    lineHeight: "normal",
    margin: 0,
    overflowWrap: "anywhere",
    paddingBlock: 3,
    paddingInline: 4,
  },
  variants: {
    tone: {
      danger: {
        "& svg": { color: "danger" },
        backgroundColor:
          "color-mix(in oklab, {colors.danger} 12%, {colors.background})",
        borderColor:
          "color-mix(in oklab, {colors.danger} 40%, {colors.background})",
      },
      info: {
        "& svg": { color: "accent" },
        backgroundColor:
          "color-mix(in oklab, {colors.accent} 10%, {colors.background})",
        borderColor:
          "color-mix(in oklab, {colors.accent} 35%, {colors.background})",
      },
      // As `info`, with a lock: the settings under it cannot change.
      locked: {
        "& svg": { color: "accent" },
        backgroundColor:
          "color-mix(in oklab, {colors.accent} 10%, {colors.background})",
        borderColor:
          "color-mix(in oklab, {colors.accent} 35%, {colors.background})",
      },
    },
  },
});
