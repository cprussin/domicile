import { css } from "../../styled-system/css";
import { flex, hstack } from "../../styled-system/patterns";

/** Manganese's periodic-table tile and name, linking to the top of its page. */
export const ManganeseMark = () => (
  <a className={markStyles} href="/manganese">
    <span aria-hidden="true" className={tileStyles}>
      <span className={numberStyles}>25</span>
      <span className={symbolStyles}>Mn</span>
    </span>
    <span className={namesStyles}>
      <span className={nameStyles}>manganese</span>
      <span className={kindStyles}>a Domicile shell</span>
    </span>
  </a>
);

const markStyles = hstack({ color: "foreground", gap: 3 });

const tileStyles = flex({
  align: "center",
  blockSize: 8.5,
  border: "2px solid {colors.accent}",
  borderRadius: "md",
  direction: "column",
  inlineSize: 8.5,
  justify: "center",
  lineHeight: "none",
});

const numberStyles = css({
  alignSelf: "flex-start",
  color: "muted",
  fontSize: "2xs",
  fontWeight: "semibold",
  paddingInlineStart: 0.75,
});

const symbolStyles = css({
  color: "accent",
  fontFamily: "display",
  fontSize: "md",
  fontWeight: "bold",
});

const namesStyles = flex({ direction: "column", lineHeight: "tight" });

const nameStyles = css({
  fontFamily: "display",
  fontSize: "xl",
  fontWeight: "bold",
  letterSpacing: "tight",
});

const kindStyles = css({ color: "muted", fontSize: "xs" });
