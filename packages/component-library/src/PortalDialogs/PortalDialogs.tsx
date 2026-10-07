import type { GlobalShortcutsHost } from "@domicile-desktop/sdk/global-shortcuts";
import { fireGlobalShortcuts } from "@domicile-desktop/sdk/global-shortcuts";
import type { Capturing, PortalRequest } from "@domicile-desktop/sdk/portal";
import {
  answerPortalRequest,
  PortalAnswer,
  PortalKind,
  stopCapturing,
  watchCapturing,
  watchPortalRequests,
} from "@domicile-desktop/sdk/portal";
import type { System, SystemHost } from "@domicile-desktop/sdk/system";
import { system } from "@domicile-desktop/sdk/system";
import { useCallback, useEffect, useMemo, useState } from "react";
import { listDirectory } from "../FilePicker/list-directory";
import { AccessDialog } from "./AccessDialog";
import { AccountDialog } from "./AccountDialog";
import { AppChooserDialog } from "./AppChooserDialog";
import { appName } from "./app-name";
import { CapturingIndicator } from "./CapturingIndicator";
import { FileChooserDialog } from "./FileChooserDialog";
import { GlobalShortcutsDialog } from "./GlobalShortcutsDialog";
import { InputCaptureDialog } from "./InputCaptureDialog";
import { RemoteDesktopDialog } from "./RemoteDesktopDialog";

/** No shell chords; one array, so the default is stable across renders. */
const NONE: readonly string[] = [];

type Props = {
  /** The desktop `Shell` is handed. */
  host: GlobalShortcutsHost & SystemHost;
  /**
   * The display to show a dialog on when it has no parent window. Needs a
   * `DisplayProvider`; without it, a dialog is centered on the whole page.
   */
  screen?: string | undefined;
  /** How dialogs read the desktop's files, for tests. */
  systemOf?: typeof system | undefined;
  /**
   * The display showing the `<app>` with this id, for a dialog modal over
   * it. `undefined` uses `screen`.
   */
  screenOf?: ((appId: string) => string | undefined) | undefined;
  /** The shell's own chords, which a global shortcuts review flags. */
  shellChords?: readonly string[] | undefined;
};

/**
 * Every dialog applications ask for through `xdg-desktop-portal`, one at a
 * time, oldest first, and an indicator for each session that controls or
 * captures input. Requests of a kind it has no dialog for are refused.
 * Inhibitors are not questions, so it leaves them be. It also fires the
 * chords applications hold through the GlobalShortcuts portal. See
 * docs/architecture/PORTALS.md.
 */
export const PortalDialogs = ({
  host,
  screen,
  screenOf,
  shellChords = NONE,
  systemOf = system,
}: Props) => {
  const [requests, setRequests] = useState<readonly PortalRequest[]>([]);
  const files = useMemo(() => systemOf(host), [systemOf, host]);
  const list = useCallback(
    (path: string) => listDirectory(files, path),
    [files],
  );
  const [sessions, setSessions] = useState<readonly Capturing[]>([]);

  useEffect(() => watchPortalRequests(host, setRequests), [host]);
  useEffect(() => watchCapturing(host, setSessions), [host]);
  useEffect(() => fireGlobalShortcuts(host), [host]);

  useEffect(() => {
    for (const request of requests) {
      if (request.kind === PortalKind.Unknown) {
        answerPortalRequest(host, request.id, PortalAnswer.Refused());
      }
    }
  }, [host, requests]);

  const shown = requests.find(isAsked);
  return (
    <>
      <CapturingIndicator
        screen={screen}
        sessions={sessions}
        stop={(id) => {
          stopCapturing(host, id);
        }}
      />
      {shown !== undefined && (
        <Dialog
          answer={(answer) => {
            answerPortalRequest(host, shown.id, answer);
          }}
          key={shown.id}
          list={list}
          request={shown}
          screen={screenFor(shown, screen, screenOf)}
          shellChords={shellChords}
          system={files}
        />
      )}
    </>
  );
};

/** The dialog for `request`'s kind. */
const Dialog = ({
  answer,
  list,
  request,
  screen,
  shellChords,
  system: files,
}: {
  answer: (answer: PortalAnswer) => void;
  list: (path: string) => Promise<readonly string[]>;
  request: PortalRequest;
  screen: string | undefined;
  shellChords: readonly string[];
  system: System;
}) => {
  switch (request.kind) {
    case PortalKind.Access:
      return (
        <AccessDialog
          answer={answer}
          asker={appName(request.appId)}
          body={request.body}
          screen={screen}
        />
      );
    case PortalKind.RemoteDesktop:
      return (
        <RemoteDesktopDialog
          answer={answer}
          asker={appName(request.appId)}
          body={request.body}
          screen={screen}
        />
      );
    case PortalKind.InputCapture:
      return (
        <InputCaptureDialog
          answer={answer}
          asker={appName(request.appId)}
          body={request.body}
          screen={screen}
        />
      );
    case PortalKind.AppChooser:
      return (
        <AppChooserDialog
          answer={answer}
          asker={appName(request.appId)}
          body={request.body}
          screen={screen}
          system={files}
        />
      );
    case PortalKind.FileChooser:
      return (
        <FileChooserDialog
          answer={answer}
          body={request.body}
          list={list}
          screen={screen}
        />
      );
    case PortalKind.Account:
      return (
        <AccountDialog
          answer={answer}
          asker={appName(request.appId)}
          body={request.body}
          screen={screen}
        />
      );
    case PortalKind.GlobalShortcuts:
      return (
        <GlobalShortcutsDialog
          answer={answer}
          asker={appName(request.appId)}
          body={request.body}
          screen={screen}
          shellChords={shellChords}
        />
      );
    case PortalKind.Inhibit:
    case PortalKind.Unknown:
      return undefined;
  }
};

/** The display for `request`: its parent window's, else `screen`. */
const screenFor = (
  request: PortalRequest,
  screen: string | undefined,
  screenOf: Props["screenOf"],
): string | undefined => {
  const parents =
    request.parentAppId === undefined
      ? undefined
      : screenOf?.(request.parentAppId);
  return parents ?? screen;
};

/** Whether `request` is a question this draws a dialog for. */
const isAsked = (request: PortalRequest): boolean => {
  switch (request.kind) {
    case PortalKind.Access:
    case PortalKind.AppChooser:
    case PortalKind.FileChooser:
    case PortalKind.RemoteDesktop:
    case PortalKind.InputCapture:
    case PortalKind.Account:
    case PortalKind.GlobalShortcuts:
      return true;
    case PortalKind.Inhibit:
    case PortalKind.Unknown:
      return false;
  }
};
