import type { PortalHost, PortalRequest } from "@domicile-desktop/sdk/portal";
import {
  answerPortalRequest,
  PortalAnswer,
  PortalKind,
  watchPortalRequests,
} from "@domicile-desktop/sdk/portal";
import { useEffect, useState } from "react";
import { AccessDialog } from "./AccessDialog";

type Props = {
  /** The desktop `Shell` is handed. */
  host: PortalHost;
  /**
   * The display to show a dialog on when it has no parent window. Needs a
   * `DisplayProvider`; without it, a dialog is centered on the whole page.
   */
  screen?: string | undefined;
};

/**
 * Every dialog applications ask for through `xdg-desktop-portal`, one at a
 * time, oldest first. Requests of a kind it has no dialog for are refused. See
 * docs/architecture/PORTALS.md.
 */
export const PortalDialogs = ({ host, screen }: Props) => {
  const [requests, setRequests] = useState<readonly PortalRequest[]>([]);

  useEffect(() => watchPortalRequests(host, setRequests), [host]);

  useEffect(() => {
    for (const request of requests) {
      if (request.kind === PortalKind.Unknown) {
        answerPortalRequest(host, request.id, PortalAnswer.Refused());
      }
    }
  }, [host, requests]);

  const shown = requests.find((request) => request.kind !== PortalKind.Unknown);
  return shown === undefined ? undefined : (
    <Dialog
      answer={(answer) => {
        answerPortalRequest(host, shown.id, answer);
      }}
      key={shown.id}
      request={shown}
      screen={screen}
    />
  );
};

/** The dialog for `request`'s kind. */
const Dialog = ({
  answer,
  request,
  screen,
}: {
  answer: (answer: PortalAnswer) => void;
  request: PortalRequest;
  screen: string | undefined;
}) => {
  switch (request.kind) {
    case PortalKind.Access:
      return (
        <AccessDialog
          answer={answer}
          asker={askerName(request.appId)}
          body={request.body}
          screen={screen}
        />
      );
    case PortalKind.Unknown:
      return undefined;
  }
};

/** How a dialog names the application asking. */
const askerName = (appId: string): string =>
  appId === "" ? "An application" : appId;
