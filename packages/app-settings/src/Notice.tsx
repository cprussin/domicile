import { InfoIcon } from "@phosphor-icons/react/dist/ssr/Info";
import { WarningCircleIcon } from "@phosphor-icons/react/dist/ssr/WarningCircle";
import type { ReactNode } from "react";

import { cva } from "../styled-system/css";

type Props = {
  children: ReactNode;
  tone?: "info" | "danger" | undefined;
};

/** A line above a page's settings: why they are read-only, or what failed. */
export const Notice = ({ children, tone = "info" }: Props) => (
  <p className={noticeStyles({ tone })} role="status">
    {tone === "danger" ? (
      <WarningCircleIcon size={18} weight="fill" />
    ) : (
      <InfoIcon size={18} weight="fill" />
    )}
    <span>{children}</span>
  </p>
);

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
    },
  },
});
