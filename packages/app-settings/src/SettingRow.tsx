import type { ReactNode } from "react";

import { css, cva } from "../styled-system/css";
import { flex } from "../styled-system/patterns";
import type { ConfigPath } from "./config-document";
import { Changed } from "./temporary-changes";

type Props = {
  /** The control, which names itself with the same `title`. */
  children: ReactNode;
  hint?: ReactNode | undefined;
  title: string;
  /**
   * Where the setting is in the config, so the row says when a temporary
   * change differs from it.
   */
  path?: ConfigPath | undefined;
  /**
   * Whether a rule parts it from the row above. Without one it has no
   * padding of its own, for a list that spaces its rows apart.
   */
  divided?: boolean | undefined;
};

/** One setting: its name and hint beside its control. */
export const SettingRow = ({
  children,
  divided = true,
  hint,
  path,
  title,
}: Props) => (
  <div className={rowStyles({ divided })}>
    <div className={textStyles}>
      <span className={titleStyles}>{title}</span>
      {hint !== undefined && <span className={hintStyles}>{hint}</span>}
      {path !== undefined && <Changed path={path} title={title} />}
    </div>
    <div className={controlStyles}>{children}</div>
  </div>
);

const rowStyles = cva({
  base: flex.raw({
    align: "center",
    gap: 6,
    justify: "space-between",
    wrap: "wrap",
  }),
  variants: {
    divided: {
      false: {},
      true: {
        "&:first-of-type": { borderBlockStart: "none", paddingBlockStart: 0 },
        "&:last-of-type": { paddingBlockEnd: 0 },
        borderBlockStart: "1px solid {colors.border}",
        paddingBlock: 3.5,
      },
    },
  },
});

const textStyles = flex({
  direction: "column",
  flex: "1 1 {spacing.56}",
  gap: 0.5,
  minInlineSize: 0,
});

const titleStyles = css({
  color: "foreground",
  fontSize: "sm",
  fontWeight: "medium",
});

const hintStyles = css({
  color: "muted",
  fontSize: "xs",
  lineHeight: "normal",
});

const controlStyles = flex({
  alignItems: "center",
  flex: "0 1 auto",
  gap: 2,
  justify: "flex-end",
  minInlineSize: 0,
});
