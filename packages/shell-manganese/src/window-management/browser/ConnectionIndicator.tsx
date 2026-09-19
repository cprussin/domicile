import { Button } from "@domicile/component-library/Button";
import { Popover } from "@domicile/component-library/Popover";
import { InfoIcon } from "@phosphor-icons/react/dist/ssr/Info";
import { LockIcon } from "@phosphor-icons/react/dist/ssr/Lock";
import { QuestionIcon } from "@phosphor-icons/react/dist/ssr/Question";
import { WarningIcon } from "@phosphor-icons/react/dist/ssr/Warning";
import { WarningOctagonIcon } from "@phosphor-icons/react/dist/ssr/WarningOctagon";
import type { ReactNode } from "react";

import { css } from "../../../styled-system/css";
import { ConnectionSafety } from "../../address/connection-safety";

type Props = {
  /** The browser's verdict on the connection behind the page being shown. */
  security: ConnectionSafety;
  /**
   * The address that verdict is about.
   *
   * THE ONE THE VERDICT CAME WITH. Both reach the chrome in one message about
   * one entry — see `useShownPage` — and handing this component an address
   * from anywhere else would make it name a host the lock beside it was never
   * about.
   */
  url: string;
};

/**
 * The lock at the inline start of the address bar, and what it opens.
 *
 * WHAT IT DRAWS IS THE BROWSER'S ANSWER. The engine computes it with
 * `security_state::GetSecurityLevel` over the guest's visible entry, which is
 * the same function over the same entry Chrome's own omnibox lock comes from —
 * so an expired certificate, a name mismatch, a page running active mixed
 * content and a connection that failed all read here exactly as they read
 * there. This component chooses an icon and a sentence; it does not judge a
 * connection, and it has no way to.
 *
 * It used to derive a lock from the URL scheme, which is a claim that a
 * certificate validated made without anyone having looked. That is the bug
 * this replaced.
 */
export const ConnectionIndicator = ({ security, url }: Props) => {
  const { body, mark, title } = INDICATORS[security];
  const host = hostOf(url);
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
      {host === undefined ? undefined : (
        <span className={hostStyles}>{host}</span>
      )}
      <span>{body}</span>
    </Popover>
  );
};

// The four colors a mark is drawn in, one `css(...)` call at a time. See
// `INDICATORS` below for why they are not a `cva` keyed by the verdict.
const secureMarkStyles = css({
  alignItems: "center",
  color: "success",
  display: "inline-flex",
});

const neutralMarkStyles = css({
  alignItems: "center",
  color: "muted",
  display: "inline-flex",
});

const warningMarkStyles = css({
  alignItems: "center",
  color: "warning",
  display: "inline-flex",
});

const dangerousMarkStyles = css({
  alignItems: "center",
  color: "danger",
  display: "inline-flex",
});

/**
 * Everything the indicator draws and says, per verdict.
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
  [ConnectionSafety.Dangerous]: {
    body: "The browser could not establish a private connection to this site. Its certificate did not validate, or the page is running content that undoes the encryption. You should not enter anything sensitive here.",
    mark: (
      <span className={dangerousMarkStyles}>
        <WarningOctagonIcon size={14} />
      </span>
    ),
    title: "Connection is not private",
  },
  [ConnectionSafety.Neutral]: {
    body: "This address is not a network connection, so there is nothing to encrypt. The page comes from this machine or from the browser itself.",
    mark: (
      <span className={neutralMarkStyles}>
        <InfoIcon size={14} />
      </span>
    ),
    title: "Connection is local",
  },
  [ConnectionSafety.Secure]: {
    body: "The browser validated this site's certificate, and what passes between here and it is encrypted. That is a statement about the connection and not about the site: a page can be reached securely and still not be worth trusting.",
    mark: (
      <span className={secureMarkStyles}>
        <LockIcon size={14} />
      </span>
    ),
    title: "Connection is secure",
  },
  // THE ONE THAT MUST NEVER LOOK LIKE ANY OF THE OTHERS. It is the browser
  // having said nothing — a guest that has committed no page, or an engine
  // older than the report — and the tempting thing to do with it is fall back
  // to reading the scheme, which is the padlock-without-a-certificate this
  // whole change removed. So it says what it does not know instead.
  [ConnectionSafety.Unstated]: {
    body: "The browser has not reported on this page's connection. Until it does, nothing here is a statement about whether the page is encrypted or whether its certificate is valid.",
    mark: (
      <span className={neutralMarkStyles}>
        <QuestionIcon size={14} />
      </span>
    ),
    title: "Connection is not known",
  },
  [ConnectionSafety.Warning]: {
    body: "This page was not reached over an encrypted connection, so anything sent to or from it can be read and changed by anything on the path between here and the site.",
    mark: (
      <span className={warningMarkStyles}>
        <WarningIcon size={14} />
      </span>
    ),
    title: "Connection is not secure",
  },
};

const hostStyles = css({
  color: "foreground",
  fontFamily: "mono",
  fontSize: "xs",
  overflowWrap: "anywhere",
});

/**
 * The host of `url`, or `undefined` when there is not one to show.
 *
 * `URL.parse` rather than the constructor, and that is what sets this apart
 * from every other address in this shell: the rest were built by
 * `typedAddress` or opened by the desktop, so one that will not parse is a bug
 * to fail loudly on. THIS one is whatever the browser is showing — an engine
 * newer than this page could report a form of address it cannot read — and a
 * browser window that threw out of its own render over an unfamiliar address
 * would take the desktop's chrome down with it.
 */
const hostOf = (url: string): string | undefined => {
  const parsed = URL.parse(url);
  return parsed === null || parsed.host === "" ? undefined : parsed.host;
};
