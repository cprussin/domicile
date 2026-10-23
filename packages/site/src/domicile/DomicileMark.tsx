import { css } from "../../styled-system/css";
import { hstack } from "../../styled-system/patterns";

/** Domicile's mark and name, linking to the top of its page. */
export const DomicileMark = () => (
  <a className={markStyles} href="/">
    <svg
      aria-hidden="true"
      className={iconStyles}
      fill="none"
      viewBox="0 0 28 28"
    >
      <path
        d="M4 13 14 4l10 9v11H4V13Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path
        className={chevronStyles}
        d="m11 15-3 3 3 3M17 15l3 3-3 3"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
    <span className={nameStyles}>domicile</span>
  </a>
);

const markStyles = hstack({ color: "foreground", gap: 2.5 });

const iconStyles = css({ blockSize: 7, color: "accent", inlineSize: 7 });

const chevronStyles = css({ color: "foreground" });

const nameStyles = css({
  fontFamily: "display",
  fontSize: "xl",
  fontWeight: "bold",
  letterSpacing: "tight",
});
