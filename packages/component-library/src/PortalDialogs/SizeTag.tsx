import { center } from "../../styled-system/patterns";

type Props = { width: number; height: number };

/** An area's size, tagged on its top left corner. */
export const SizeTag = ({ height, width }: Props) => (
  <span className={sizeStyles}>{`${String(width)} × ${String(height)}`}</span>
);

const sizeStyles = center({
  backgroundColor: "accent",
  borderEndEndRadius: "sm",
  color: "background",
  fontSize: "xs",
  fontVariantNumeric: "tabular-nums",
  fontWeight: "medium",
  insetBlockStart: 0,
  insetInlineStart: 0,
  paddingBlock: 0.5,
  paddingInline: 1.5,
  position: "absolute",
  whiteSpace: "nowrap",
});
