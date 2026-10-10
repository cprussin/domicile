import { css } from "../../../styled-system/css";

type Props = {
  /** The address of the link under the pointer, or `""` for none. */
  url: string;
};

/**
 * Shows the address of the link under the pointer, like Chrome's status
 * bubble. The engine draws none; see `targetUrl` on `<webview>`.
 */
export const LinkTarget = ({ url }: Props) =>
  url === "" ? undefined : (
    <output aria-label="Link" className={bubbleStyles}>
      {url}
    </output>
  );

// In the page's bottom left corner, as in Chrome. Ignores the pointer so it
// never blocks the page.
const bubbleStyles = css({
  backgroundColor: "card",
  border: "1px solid {colors.border}",
  borderBlockEndWidth: 0,
  borderInlineStartWidth: 0,
  borderStartEndRadius: "md",
  color: "foreground",
  fontSize: "xs",
  insetBlockEnd: 0,
  insetInlineStart: 0,
  maxInlineSize: "50%",
  overflow: "hidden",
  paddingBlock: 0.5,
  paddingInline: 2,
  pointerEvents: "none",
  position: "absolute",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});
