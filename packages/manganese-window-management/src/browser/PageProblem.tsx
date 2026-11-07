import { Button } from "@domicile-desktop/component-library/Button";
import type { Icon } from "@phosphor-icons/react";
import { ShieldWarningIcon } from "@phosphor-icons/react/dist/ssr/ShieldWarning";
import { SmileyXEyesIcon } from "@phosphor-icons/react/dist/ssr/SmileyXEyes";
import { WarningIcon } from "@phosphor-icons/react/dist/ssr/Warning";
import { WifiSlashIcon } from "@phosphor-icons/react/dist/ssr/WifiSlash";
import type { RefCallback } from "react";
import { useState } from "react";

import { css } from "../../styled-system/css";
import { center, flex } from "../../styled-system/patterns";
import type { PageProblem as Problem } from "../usePageProblem";

type Props = {
  problem: Problem;
  /** Whether the page has history to go back to. */
  canGoBack: boolean;
  onGoBack: () => void;
  onReload: () => void;
  onProceed: () => void;
  /** Gets the element to focus: the first answer. */
  ref?: RefCallback<HTMLElement> | undefined;
};

/**
 * What a browser window shows in place of a page that failed to load or
 * crashed, as Chrome's error, warning and "Aw, Snap!" pages do. Covers the
 * page, which the engine leaves blank.
 *
 * A warning leads with Go back; Continue anyway waits behind Details, and is
 * offered only where the browser allows it.
 */
export const PageProblem = ({
  canGoBack,
  onGoBack,
  onProceed,
  onReload,
  problem,
  ref,
}: Props) => {
  const [details, setDetails] = useState(false);
  const words = wordsFor(problem);
  const Glyph = words.icon;
  const warns = problem.kind === "certificate" || problem.kind === "warning";
  return (
    <section aria-label={words.title} className={rootStyles}>
      <span className={discStyles}>
        <Glyph aria-hidden size={28} weight="bold" />
      </span>
      <h2 className={titleStyles}>{words.title}</h2>
      <p className={messageStyles}>{words.message}</p>
      {problem.kind !== "gone" && (
        <p className={codeStyles}>
          {problem.kind === "http"
            ? `HTTP ${problem.httpStatus}`
            : problem.error}
        </p>
      )}
      <div className={answersStyles}>
        {warns ? (
          <>
            {canGoBack && (
              <Button onClick={onGoBack} ref={ref} variant="accent">
                Go back
              </Button>
            )}
            {problem.canProceed && !details && (
              <Button
                onClick={() => {
                  setDetails(true);
                }}
                ref={canGoBack ? undefined : ref}
                variant="outline"
              >
                Details
              </Button>
            )}
          </>
        ) : (
          <>
            <Button onClick={onReload} ref={ref} variant="accent">
              {problem.kind === "gone" ? "Reload" : "Try again"}
            </Button>
            {canGoBack && problem.kind !== "gone" && (
              <Button onClick={onGoBack} variant="outline">
                Go back
              </Button>
            )}
          </>
        )}
      </div>
      {warns && problem.canProceed && details && (
        <div className={detailsStyles}>
          <p className={messageStyles}>{words.risk}</p>
          <Button onClick={onProceed} size="sm" variant="outline">
            Continue anyway
          </Button>
        </div>
      )}
    </section>
  );
};

type Words = { icon: Icon; message: string; risk?: string; title: string };

/** The page's icon, title and text. */
const wordsFor = (problem: Problem): Words => {
  if (problem.kind === "gone") {
    return problem.reason === "oom"
      ? {
          icon: SmileyXEyesIcon,
          message: "It used more memory than this computer could give it.",
          title: "This page ran out of memory",
        }
      : {
          icon: SmileyXEyesIcon,
          message: "Something went wrong while showing it.",
          title: "This page crashed",
        };
  }
  const host = hostOf(problem.url);
  switch (problem.kind) {
    case "http": {
      return {
        icon: WarningIcon,
        message: "The site answered with an error and nothing to show.",
        title: `${host} isn't working`,
      };
    }
    case "certificate": {
      return {
        icon: ShieldWarningIcon,
        message: `Its certificate isn't trusted, so someone could be pretending to be ${host} to read what you send.`,
        risk: "Only continue if you know why this site's certificate isn't trusted, such as a device on your own network.",
        title: "Your connection isn't private",
      };
    }
    case "warning": {
      return {
        icon: ShieldWarningIcon,
        message:
          "The browser stopped it before it loaded. It may try to trick you or harm your computer.",
        risk: "Only continue if you trust this site.",
        title: `${host} may not be safe`,
      };
    }
    case "network": {
      return networkWords(problem.error, host);
    }
  }
};

/** A network failure's title and text, by Chromium's name for it. */
const networkWords = (error: string, host: string): Words => {
  switch (error) {
    case "ERR_INTERNET_DISCONNECTED": {
      return {
        icon: WifiSlashIcon,
        message: "Connect to the internet and try again.",
        title: "You're offline",
      };
    }
    case "ERR_NAME_NOT_RESOLVED":
    case "ERR_NAME_RESOLUTION_FAILED": {
      return {
        icon: WifiSlashIcon,
        message:
          "The address couldn't be found. Check it for typos, or try again once you're online.",
        title: `Can't reach ${host}`,
      };
    }
    case "ERR_CONNECTION_REFUSED": {
      return {
        icon: WifiSlashIcon,
        message: `${host} refused to connect.`,
        title: `Can't reach ${host}`,
      };
    }
    case "ERR_CONNECTION_TIMED_OUT":
    case "ERR_TIMED_OUT": {
      return {
        icon: WifiSlashIcon,
        message: `${host} took too long to respond.`,
        title: `Can't reach ${host}`,
      };
    }
    case "ERR_TOO_MANY_REDIRECTS": {
      return {
        icon: WarningIcon,
        message: `${host} sent the browser around in circles.`,
        title: `${host} isn't working`,
      };
    }
    case "ERR_FILE_NOT_FOUND": {
      return {
        icon: WarningIcon,
        message: "It may have been moved, renamed or deleted.",
        title: "File not found",
      };
    }
    case "ERR_BLOCKED_BY_CLIENT":
    case "ERR_BLOCKED_BY_ADMINISTRATOR": {
      return {
        icon: ShieldWarningIcon,
        message: "It can't be opened here.",
        title: "This page is blocked",
      };
    }
    default: {
      return {
        icon: WifiSlashIcon,
        message: "Something went wrong reaching it.",
        title: `Can't reach ${host}`,
      };
    }
  }
};

/** The address's host, or the address itself when it has none. */
const hostOf = (url: string): string => {
  const parsed = URL.parse(url);
  return parsed === null || parsed.host === "" ? url : parsed.host;
};

// Covers the blank page, in the window's own surface.
const rootStyles = flex({
  align: "center",
  backgroundColor: "background",
  direction: "column",
  gap: 3,
  inset: 0,
  justify: "center",
  overflowY: "auto",
  padding: 8,
  position: "absolute",
  textAlign: "center",
});

const discStyles = center({
  backgroundColor: "fill",
  blockSize: 16,
  borderRadius: "full",
  color: "muted",
  inlineSize: 16,
  marginBlockEnd: 2,
});

const titleStyles = css({
  color: "foreground",
  fontSize: "xl",
  fontWeight: "semibold",
  margin: 0,
  maxInlineSize: "32rem",
  overflowWrap: "anywhere",
  textWrap: "balance",
});

const messageStyles = css({
  color: "muted",
  fontSize: "sm",
  margin: 0,
  maxInlineSize: "28rem",
  textWrap: "balance",
});

const codeStyles = css({
  color: "muted",
  fontFamily: "mono",
  fontSize: "xs",
  margin: 0,
});

const answersStyles = flex({ gap: 2, marginBlockStart: 2 });

const detailsStyles = flex({
  align: "center",
  direction: "column",
  gap: 2,
  marginBlockStart: 2,
});
