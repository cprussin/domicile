import { WarningCircleIcon } from "@phosphor-icons/react/dist/ssr/WarningCircle";
import type { ReactNode } from "react";

import { cva, cx } from "../../styled-system/css";
import { center } from "../../styled-system/patterns";
import type { Size } from "../control-sizes";

import { multilineSizeStyles } from "./multilineSizeStyles";

type Props = {
  multiline?: boolean | undefined;
  prefixIcon: ReactNode | undefined;
  size: Size;
};

export const PrefixIconStack = ({
  multiline = false,
  prefixIcon,
  size,
}: Props) => {
  const lineMetrics = multiline === true ? multilineSizeStyles({ size }) : "";
  if (prefixIcon === undefined) {
    return (
      <PrefixStandalone
        lineMetrics={lineMetrics}
        multiline={multiline}
        size={size}
      />
    );
  } else {
    return (
      <PrefixStack
        lineMetrics={lineMetrics}
        multiline={multiline}
        prefixIcon={prefixIcon}
      />
    );
  }
};

type StandaloneProps = {
  lineMetrics: string;
  multiline: boolean;
  size: Size;
};

const PrefixStandalone = ({
  lineMetrics,
  multiline,
  size,
}: StandaloneProps) => (
  <span
    className={cx(outerStyles({ multiline }), standaloneStyles({ size }))}
    data-prefix-standalone=""
  >
    <span className={cx(invalidIndicatorStyles, lineMetrics)}>
      <WarningCircleIcon />
    </span>
  </span>
);

// When the control isn't invalid the standalone slot collapses to 0 width
// (grid-template-columns: 0fr) AND offsets the wrapper's flex `gap` with an
// equal-magnitude negative `marginInlineEnd` — otherwise the empty slot
// would still reserve a visible gap before the control. On invalid,
// `wrapperBase` overrides both (`gridTemplateColumns: 1fr` and
// `marginInlineEnd: 0`), so the column expands AND the gap re-appears,
// sliding the warning icon in from the left and pushing the control
// rightward. The per-size negative margin values match the `control`
// recipe's per-size `gap`.
const standaloneStyles = cva({
  base: {
    gridTemplateColumns: "0fr",
    transition:
      "grid-template-columns {durations.fast} {easings.default}, margin-inline-end {durations.fast} {easings.default}",
  },
  variants: {
    size: {
      "2xl": { marginInlineEnd: -4 },
      "3xl": { marginInlineEnd: -5.5 },
      "4xl": { marginInlineEnd: -7.5 },
      lg: { marginInlineEnd: -2.5 },
      md: { marginInlineEnd: -2 },
      sm: { marginInlineEnd: -1.5 },
      xl: { marginInlineEnd: -3 },
      xs: { marginInlineEnd: -1 },
    },
  },
});

type StackProps = {
  lineMetrics: string;
  multiline: boolean;
  prefixIcon: ReactNode;
};

const PrefixStack = ({ lineMetrics, multiline, prefixIcon }: StackProps) => (
  <span className={outerStyles({ multiline })} data-prefix-stack="">
    <span
      className={cx(decorationStyles, lineMetrics)}
      data-prefix-decoration=""
    >
      {prefixIcon}
    </span>
    <span
      className={cx(invalidOverlayStyles, lineMetrics)}
      data-prefix-invalid=""
    >
      <WarningCircleIcon />
    </span>
  </span>
);

const invalidIndicatorStyles = center({
  color: "danger",
  inline: true,
  minInlineSize: 0,
  transform: "translateX(-100%)",
  transition: "transform {durations.fast} {easings.default}",
});

const decorationStyles = center({
  gridArea: "1 / 1",
  inline: true,
  transform: "translateY(0)",
  transition:
    "transform {durations.fast} {easings.default}, color {durations.fast} {easings.default}",
});

const invalidOverlayStyles = center({
  color: "danger",
  gridArea: "1 / 1",
  inline: true,
  transform: "translateY(-100%)",
  transition: "transform {durations.fast} {easings.default}",
});

const outerStyles = cva({
  base: {
    display: "inline-grid",
    flexShrink: 0,
    overflow: "hidden",
    pointerEvents: "none",
  },
  variants: {
    multiline: {
      true: {
        alignSelf: "flex-start",
        marginBlock: "-1px",
      },
    },
  },
});
