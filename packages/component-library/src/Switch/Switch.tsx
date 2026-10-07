import { Switch as BaseSwitch } from "@base-ui/react/switch";
import { useId } from "react";

import { css } from "../../styled-system/css";
import { hstack } from "../../styled-system/patterns";
import type { ExtendProps } from "../extend-props";

type Props = ExtendProps<
  typeof BaseSwitch.Root,
  {
    /** The text beside the switch, which also names it. */
    label: string;
  }
>;

/** An on/off switch with its label, over base-ui's Switch. */
export const Switch = ({ label, ...rootProps }: Props) => {
  const id = useId();
  return (
    <label className={labelStyles} htmlFor={id}>
      <BaseSwitch.Root className={rootStyles} id={id} {...rootProps}>
        <BaseSwitch.Thumb className={thumbStyles} />
      </BaseSwitch.Root>
      {label}
    </label>
  );
};

const labelStyles = hstack({
  color: "foreground",
  cursor: "pointer",
  gap: 2,
});

const rootStyles = css({
  "&:focus-visible": {
    outline: "{spacing.0.5} solid {colors.accent}",
    outlineOffset: 0.5,
  },
  "&[data-checked]": { backgroundColor: "accent" },
  backgroundColor: "borderStrong",
  blockSize: 5,
  borderRadius: "full",
  borderStyle: "none",
  cursor: "pointer",
  flexShrink: 0,
  inlineSize: 9,
  padding: 0.5,
  position: "relative",
  transition: "background-color {durations.fast} {easings.default}",
});

const thumbStyles = css({
  "&[data-checked]": { translate: "{spacing.4} 0" },
  backgroundColor: "background",
  blockSize: 4,
  borderRadius: "full",
  boxShadow: "{shadows.lifted}",
  display: "block",
  inlineSize: 4,
  transition: "translate {durations.fast} {easings.out}",
});
