import { Button } from "@domicile-desktop/component-library/Button";

import { css } from "../../../styled-system/css";
import { hstack, vstack } from "../../../styled-system/patterns";
import { PERMISSION_ICONS, PERMISSION_LABELS } from "./permission-names";
import type { PermissionRequest } from "./usePermissionRequest";

type Props = {
  /** Who asks, as the user knows it: a site's host or an extension's name. */
  asker: string;
  request: PermissionRequest;
};

/** A page's permission request: who asks, for what, and the two answers. */
export const PermissionAsk = ({ asker, request }: Props) => (
  <section aria-label="Request" className={askingStyles}>
    <span className={askingTextStyles}>
      <strong className={askingHostStyles}>{asker}</strong>{" "}
      <span>wants to use</span>
    </span>
    <ul aria-label="Requested" className={requestedStyles}>
      {request.permissions.map((permission) => (
        <li className={chipStyles} key={permission}>
          {PERMISSION_ICONS[permission]}
          {PERMISSION_LABELS[permission]}
        </li>
      ))}
    </ul>
    <div className={answersStyles}>
      <Button onClick={request.deny} size="sm" variant="primary">
        Block
      </Button>
      <Button onClick={request.allow} size="sm" variant="accent">
        Allow
      </Button>
    </div>
  </section>
);

// Tinted with the accent, so the question stands apart from the settings.
const askingStyles = vstack({
  alignItems: "stretch",
  backgroundColor: "color-mix(in oklab, {colors.accent} 10%, {colors.card})",
  border: "1px solid color-mix(in oklab, {colors.accent} 35%, {colors.border})",
  borderRadius: "lg",
  gap: 2.5,
  padding: 3,
});

const askingTextStyles = css({
  color: "foreground",
  fontSize: "sm",
});

const askingHostStyles = css({
  fontWeight: "semibold",
  overflowWrap: "anywhere",
});

const requestedStyles = hstack({
  flexWrap: "wrap",
  gap: 1.5,
  listStyle: "none",
  margin: 0,
  padding: 0,
});

const chipStyles = hstack({
  backgroundColor: "color-mix(in oklab, {colors.accent} 18%, {colors.card})",
  borderRadius: "full",
  color: "foreground",
  fontSize: "xs",
  gap: 1.5,
  paddingBlock: 1,
  paddingInline: 2.5,
});

// Equal halves, Block first, as in Chrome's prompt.
const answersStyles = css({
  "& > *": { flex: "1 1 0" },
  display: "flex",
  gap: 2,
});
