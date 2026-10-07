import type { GlobalShortcutsHost } from "@domicile-desktop/sdk/global-shortcuts";
import { fireGlobalShortcuts } from "@domicile-desktop/sdk/global-shortcuts";
import type { Capturing, PortalRequest } from "@domicile-desktop/sdk/portal";
import {
  answerPortalRequest,
  CapturingKind,
  CastSourceKind,
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
import type { App } from "../useApps/useApps";
import { useApps } from "../useApps/useApps";
import { AccessDialog } from "./AccessDialog";
import { AccountDialog } from "./AccountDialog";
import { AppChooserDialog } from "./AppChooserDialog";
import { CapturingIndicator } from "./CapturingIndicator";
import { FileChooserDialog } from "./FileChooserDialog";
import { GlobalShortcutsDialog } from "./GlobalShortcutsDialog";
import { InputCaptureDialog } from "./InputCaptureDialog";
import { LauncherDialog } from "./LauncherDialog";
import { PickColorDialog } from "./PickColorDialog";
import { PrintDialog } from "./PrintDialog";
import { RemoteDesktopDialog } from "./RemoteDesktopDialog";
import { ScreenCastDialog } from "./ScreenCastDialog";
import { ScreenshotDialog } from "./ScreenshotDialog";
import { UsbDialog } from "./UsbDialog";
import { WallpaperDialog } from "./WallpaperDialog";

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
  /**
   * Leave screen casts out of the capturing indicator, for a shell that shows
   * them itself.
   */
  omitScreenCasts?: boolean | undefined;
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
  omitScreenCasts = false,
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
  const apps = useApps(files, [
    ...requests.flatMap(appIds),
    ...sessions.map((session) => session.appId),
  ]);

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
        apps={apps}
        screen={screen}
        sessions={
          omitScreenCasts
            ? sessions.filter(
                (session) => session.kind !== CapturingKind.ScreenCast,
              )
            : sessions
        }
        stop={(id) => {
          stopCapturing(host, id);
        }}
      />
      {shown !== undefined && (
        <Dialog
          answer={(answer) => {
            answerPortalRequest(host, shown.id, answer);
          }}
          apps={apps}
          asker={apps(shown.appId).name}
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
  apps,
  asker,
  list,
  request,
  screen,
  shellChords,
  system: files,
}: {
  answer: (answer: PortalAnswer) => void;
  apps: (appId: string) => App;
  asker: string;
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
          asker={asker}
          body={request.body}
          screen={screen}
        />
      );
    case PortalKind.RemoteDesktop:
      return (
        <RemoteDesktopDialog
          answer={answer}
          asker={asker}
          body={request.body}
          screen={screen}
        />
      );
    case PortalKind.InputCapture:
      return (
        <InputCaptureDialog
          answer={answer}
          asker={asker}
          body={request.body}
          screen={screen}
        />
      );
    case PortalKind.AppChooser:
      return (
        <AppChooserDialog
          answer={answer}
          asker={asker}
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
          asker={asker}
          body={request.body}
          files={files}
          screen={screen}
        />
      );
    case PortalKind.GlobalShortcuts:
      return (
        <GlobalShortcutsDialog
          answer={answer}
          asker={asker}
          body={request.body}
          screen={screen}
          shellChords={shellChords}
        />
      );
    case PortalKind.Wallpaper:
      return (
        <WallpaperDialog
          answer={answer}
          asker={asker}
          body={request.body}
          files={files}
          screen={screen}
        />
      );
    case PortalKind.DynamicLauncher:
      return (
        <LauncherDialog
          answer={answer}
          asker={asker}
          body={request.body}
          screen={screen}
        />
      );
    case PortalKind.Usb:
      return (
        <UsbDialog
          answer={answer}
          asker={asker}
          body={request.body}
          screen={screen}
        />
      );
    case PortalKind.ScreenCast:
      return (
        <ScreenCastDialog
          answer={answer}
          apps={apps}
          asker={asker}
          body={request.body}
          screen={screen}
        />
      );
    case PortalKind.Print:
      return (
        <PrintDialog
          answer={answer}
          asker={asker}
          body={request.body}
          screen={screen}
        />
      );
    case PortalKind.Screenshot:
      return (
        <ScreenshotDialog
          answer={answer}
          asker={asker}
          body={request.body}
          screen={screen}
        />
      );
    case PortalKind.PickColor:
      return (
        <PickColorDialog
          answer={answer}
          asker={asker}
          body={request.body}
          screen={screen}
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

/** The applications `request` names: who asks, and windows it may record. */
const appIds = (request: PortalRequest): string[] =>
  request.kind === PortalKind.ScreenCast
    ? [
        request.appId,
        ...request.body.sources.flatMap((source) =>
          source.kind === CastSourceKind.Window ? [source.appId] : [],
        ),
      ]
    : [request.appId];

/** Whether `request` is a question this draws a dialog for. */
const isAsked = (request: PortalRequest): boolean => {
  switch (request.kind) {
    case PortalKind.Access:
    case PortalKind.AppChooser:
    case PortalKind.FileChooser:
    case PortalKind.RemoteDesktop:
    case PortalKind.InputCapture:
    case PortalKind.DynamicLauncher:
    case PortalKind.Usb:
    case PortalKind.Account:
    case PortalKind.GlobalShortcuts:
    case PortalKind.Wallpaper:
    case PortalKind.ScreenCast:
    case PortalKind.Print:
    case PortalKind.Screenshot:
    case PortalKind.PickColor:
      return true;
    case PortalKind.Inhibit:
    case PortalKind.Unknown:
      return false;
  }
};
