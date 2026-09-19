import { Button } from "@domicile/component-library/Button";
import { Popover } from "@domicile/component-library/Popover";
import { InfoIcon } from "@phosphor-icons/react/dist/ssr/Info";
import { LockIcon } from "@phosphor-icons/react/dist/ssr/Lock";
import { WarningIcon } from "@phosphor-icons/react/dist/ssr/Warning";
import type { ReactNode } from "react";

import { css } from "../../../styled-system/css";
import {
  ConnectionSafety,
  connectionSafety,
} from "../../address/connection-safety";

type Props = {
  /**
   * The address the window was sent to.
   *
   * Which is not where the page is — see {@link ConnectionSafety} — and the
   * details below say so, because an indicator that let the user believe
   * otherwise would be worse than no indicator at all.
   */
  url: string;
};

/**
 * The lock at the inline start of the address bar, and what it opens.
 *
 * It says less than a browser's lock and says it in the same place, so what it
 * says has to be exact: the scheme of the address this window was *sent* to.
 * The panel behind it is where that fits — a line about the connection, the
 * host, and the sentence about where the page may have gone since.
 */
export const ConnectionIndicator = ({ url }: Props) => {
  const { body, mark, title } = INDICATORS[connectionSafety(url)];
  const { host } = new URL(url);
  return (
    <Popover
      align="start"
      side="bottom"
      title={title}
      trigger={
        <Button
          // The same name the panel is titled with, because at this size the
          // icon is the whole of what a sighted user reads too.
          label={title}
          size="sm"
          variant="ghost"
        >
          {mark}
        </Button>
      }
    >
      {host === "" ? undefined : <span className={hostStyles}>{host}</span>}
      <span>{body}</span>
      {/* THE CAVEAT IS PART OF THE ANSWER. A browser draws its lock from a
          certificate the network stack validated; this one is drawn from a
          scheme, and the engine reports no address for the page inside a
          window — so a link or a redirect has taken it somewhere this panel
          was never told about. */}
      <span>
        This describes where this window was sent, not where the page has gone
        since: a link or a redirect inside the page is not reported back to the
        desktop.
      </span>
    </Popover>
  );
};

// One `css(...)` per mark rather than a `cva` with a `safety` variant. The
// recipe would work — Panda reads an enum member as a variant key — but the
// color is the only thing that varies, and a recipe for one property splits
// what the indicator says across two tables keyed by the same enum. They are
// one answer, so they are in one place: see `INDICATORS` below.
const encryptedMarkStyles = css({
  alignItems: "center",
  color: "success",
  display: "inline-flex",
});

const localMarkStyles = css({
  alignItems: "center",
  color: "muted",
  display: "inline-flex",
});

const plainMarkStyles = css({
  alignItems: "center",
  color: "warning",
  display: "inline-flex",
});

/**
 * Everything the indicator draws and says, per connection.
 *
 * A record rather than a `switch` in three places: the mark, the name and the
 * sentence are one answer, and a variant added to {@link ConnectionSafety} is a
 * missing key here — a compile error — rather than a silent fall-through.
 *
 * Below the styles it reads, because this is evaluated when the module loads
 * and a `css(...)` className declared after it would not exist yet — the
 * module-load exception in /docs/guidelines/FILES.md.
 */
const INDICATORS: Readonly<
  Record<ConnectionSafety, { body: string; mark: ReactNode; title: string }>
> = {
  [ConnectionSafety.Encrypted]: {
    body: "This window asked for the page over HTTPS, so what passes between here and the site cannot be read on the way.",
    mark: (
      <span className={encryptedMarkStyles}>
        <LockIcon size={14} />
      </span>
    ),
    title: "Connection is encrypted",
  },
  [ConnectionSafety.Local]: {
    body: "This address is not a connection. The page comes from this machine rather than over the network.",
    mark: (
      <span className={localMarkStyles}>
        <InfoIcon size={14} />
      </span>
    ),
    title: "Connection is local",
  },
  [ConnectionSafety.Plain]: {
    body: "This window asked for the page over plain HTTP. Anything sent to or from the site can be read and changed by anything on the path.",
    mark: (
      <span className={plainMarkStyles}>
        <WarningIcon size={14} />
      </span>
    ),
    title: "Connection is not encrypted",
  },
};

const hostStyles = css({
  color: "foreground",
  fontFamily: "mono",
  fontSize: "xs",
  overflowWrap: "anywhere",
});
