import { Switch } from "@domicile-desktop/component-library/Switch";

import { css } from "../styled-system/css";
import { flex } from "../styled-system/patterns";

type Props = {
  label: string;
  hint?: string | undefined;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
};

/** An on/off setting: the switch and its label, with a hint under them. */
export const SwitchRow = ({
  checked,
  disabled,
  hint,
  label,
  onChange,
}: Props) => (
  <div className={rowStyles}>
    <Switch
      checked={checked}
      disabled={disabled}
      label={label}
      onCheckedChange={onChange}
    />
    {hint !== undefined && <span className={hintStyles}>{hint}</span>}
  </div>
);

const rowStyles = flex({
  "&:first-of-type": { borderBlockStart: "none", paddingBlockStart: 0 },
  "&:last-of-type": { paddingBlockEnd: 0 },
  borderBlockStart: "1px solid {colors.border}",
  direction: "column",
  fontSize: "sm",
  gap: 1,
  paddingBlock: 3.5,
});

const hintStyles = css({
  color: "muted",
  fontSize: "xs",
  paddingInlineStart: 11,
});
