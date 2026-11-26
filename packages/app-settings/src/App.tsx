import {
  createToastManager,
  Toaster,
} from "@domicile-desktop/component-library/Toaster";
import type { ComponentType, ReactNode } from "react";
import { useCallback, useMemo, useState } from "react";

import { css } from "../styled-system/css";
import { grid, vstack } from "../styled-system/patterns";
import type { ConfigDocument } from "./config-document";
import type { ConfigEditor, ConfigPageProps, Report } from "./config-editor";
import { readSettings } from "./config-schema";
import type { ConfigState } from "./config-state";
import { ConfigKind, configState, whyReadOnly } from "./config-state";
import type { Extensions } from "./extensions";
import type {
  ConfigOverride,
  SettingsFiles,
  SettingsHost,
  Target,
} from "./host";
import { Notice } from "./Notice";
import { Page } from "./Page";
import { PAGES, PageId } from "./pages";
import { AgentsPage } from "./pages/AgentsPage";
import { AppearancePage } from "./pages/AppearancePage";
import { CodePage } from "./pages/CodePage";
import { DisplaysPage } from "./pages/DisplaysPage";
import { ExtensionsPage } from "./pages/ExtensionsPage";
import { KeyboardPage } from "./pages/KeyboardPage";
import { LauncherPage } from "./pages/LauncherPage";
import { PermissionsPage } from "./pages/PermissionsPage";
import { PowerPage } from "./pages/PowerPage";
import { PrivacyPage } from "./pages/PrivacyPage";
import { ProfilesPage } from "./pages/ProfilesPage";
import { ShellPage } from "./pages/ShellPage";
import { SiteDataPage } from "./pages/SiteDataPage";
import { StartupPage } from "./pages/StartupPage";
import { TroubleshootingPage } from "./pages/TroubleshootingPage";
import { Sidebar } from "./Sidebar";
import type { TemporaryChanges } from "./temporary-changes";
import {
  TemporaryChangesProvider,
  useConfigOverrides,
  withOverrides,
} from "./temporary-changes";
import { useSettingsFiles } from "./useSettingsFiles";
import { writtenOver } from "./written-over";

/** How long a toast stays. */
const TOAST_MS = 6000;

type Props = {
  host: SettingsHost;
  extensions: Extensions;
};

/** The Settings page: the sidebar and the page it picks. */
export const App = ({ extensions, host }: Props) => {
  const [toasts] = useState(createToastManager);
  const [page, setPage] = useState(PageId.Appearance);
  const { failure, files, write } = useSettingsFiles(host);
  const overrides = useConfigOverrides(host);
  const unreachable: unknown = failure ?? overrides.failure;

  const report: Report = useCallback(
    (title) => (cause) => {
      toasts.add({
        description: cause instanceof Error ? cause.message : String(cause),
        timeout: TOAST_MS,
        title,
        type: "danger",
      });
    },
    [toasts],
  );

  const state = useMemo(
    () => (files === undefined ? undefined : configState(files)),
    [files],
  );
  const editor = useMemo(
    () =>
      state === undefined
        ? undefined
        : editorFor(state, write, overrides, report),
    [state, write, overrides, report],
  );
  const shown = PAGES[page];
  const { description, title } = shown;
  // A writable config shows them too: the shell's theme toggle and the
  // tray make them whatever the config is.
  const changes: TemporaryChanges | undefined =
    editor === undefined
      ? undefined
      : {
          overrides: overrides.overrides,
          reset: overrides.reset,
          sections: "sections" in shown ? shown.sections : [],
          setForNow: overrides.set,
          temporary: editor.temporary,
        };

  return (
    <Toaster.Provider toastManager={toasts}>
      <div className={layoutStyles}>
        <Sidebar onPage={setPage} page={page} />
        <main className={mainStyles}>
          {unreachable !== undefined && (
            <div className={failureStyles}>
              <Notice tone="danger">
                Couldn't reach the desktop's settings:{" "}
                {unreachable instanceof Error
                  ? unreachable.message
                  : String(unreachable)}
              </Notice>
            </div>
          )}
          <TemporaryChangesProvider changes={changes}>
            <PageContent
              description={description}
              editor={editor}
              extensions={extensions}
              files={files}
              host={host}
              onPage={setPage}
              page={page}
              report={report}
              state={state}
              title={title}
              write={write}
            />
          </TemporaryChangesProvider>
        </main>
        <div className={toastAreaStyles}>
          <Toaster label="Notifications">
            {(toast) => (
              <div className={toastStyles}>
                <span className={toastTitleStyles}>
                  <Toaster.Title>{toast.title}</Toaster.Title>
                </span>
                {toast.description !== undefined && (
                  <span className={toastDescriptionStyles}>
                    <Toaster.Description>
                      {toast.description}
                    </Toaster.Description>
                  </span>
                )}
              </div>
            )}
          </Toaster>
        </div>
      </div>
    </Toaster.Provider>
  );
};

type PageContentProps = {
  page: PageId;
  title: string;
  description: string;
  host: SettingsHost;
  extensions: Extensions;
  files: SettingsFiles | undefined;
  state: ConfigState | undefined;
  editor: ConfigEditor | undefined;
  write: (file: Target, text: string) => Promise<void>;
  report: Report;
  /** Opens another page. */
  onPage: (page: PageId) => void;
};

/** The page `page` names. */
const PageContent = ({
  description,
  editor,
  extensions,
  files,
  host,
  onPage,
  page,
  report,
  state,
  title,
  write,
}: PageContentProps) => {
  const named = { description, title };
  // A page of config settings, or its notice when the config can't be read.
  const configPageOf = (content: (editor: ConfigEditor) => ReactNode) =>
    editor === undefined ? (
      <Page
        {...named}
        readOnly={state === undefined ? undefined : whyReadOnly(state)}
      />
    ) : (
      content(editor)
    );
  const configPage = (Content: ComponentType<ConfigPageProps>) =>
    configPageOf((ready) => <Content {...named} editor={ready} />);
  switch (page) {
    case PageId.Extensions:
      return (
        <ExtensionsPage
          {...named}
          editor={editor}
          extensions={extensions}
          host={host}
          onChooseProfiles={() => {
            onPage(PageId.Profiles);
          }}
          readOnly={state === undefined ? undefined : whyReadOnly(state)}
          report={report}
        />
      );
    case PageId.Profiles:
      return (
        <ProfilesPage
          {...named}
          editor={editor}
          extensions={extensions}
          host={host}
          readOnly={state === undefined ? undefined : whyReadOnly(state)}
          report={report}
        />
      );
    case PageId.Permissions:
      return (
        <PermissionsPage
          {...named}
          extensions={extensions}
          host={host}
          report={report}
        />
      );
    case PageId.SiteData:
      return <SiteDataPage {...named} host={host} report={report} />;
    case PageId.Agents:
      return (
        <AgentsPage {...named} editor={editor} host={host} report={report} />
      );
    case PageId.Troubleshooting:
      return <TroubleshootingPage {...named} host={host} report={report} />;
    case PageId.Code:
      return files === undefined ? (
        <Page {...named} />
      ) : (
        <CodePage {...named} files={files} report={report} write={write} />
      );
    case PageId.Appearance:
      return configPage(AppearancePage);
    case PageId.Keyboard:
      return configPage(KeyboardPage);
    case PageId.Displays:
      return configPageOf((ready) => (
        <DisplaysPage {...named} editor={ready} host={host} report={report} />
      ));
    case PageId.Power:
      return configPage(PowerPage);
    case PageId.Privacy:
      return configPage(PrivacyPage);
    case PageId.Launcher:
      return configPage(LauncherPage);
    // Startup commands run once, as the desktop starts, so a change that
    // lasts until it restarts would never run.
    case PageId.Startup:
      return configPageOf((ready) => (
        <StartupPage
          {...named}
          editor={
            ready.temporary
              ? {
                  ...ready,
                  readOnly:
                    "Startup commands run only as the desktop starts, so they change only in your config.",
                }
              : ready
          }
        />
      ));
    case PageId.Shell:
      return configPageOf((ready) => (
        <ShellPage {...named} declared={files?.options} editor={ready} />
      ));
  }
};

/**
 * The editor for a config the form can show, or `undefined` for one it
 * cannot read. A writable JSON config takes changes in the file, showing the
 * temporary changes others made over it until one is written; any other
 * takes them as temporary changes, laid over it until the desktop restarts.
 */
const editorFor = (
  state: ConfigState,
  write: (file: Target, text: string) => Promise<void>,
  overrides: Pick<
    ReturnType<typeof useConfigOverrides>,
    "overrides" | "reset" | "set"
  >,
  report: Report,
): ConfigEditor | undefined => {
  switch (state.kind) {
    case ConfigKind.Unreadable:
      return undefined;
    case ConfigKind.Json:
      return state.file.writable
        ? {
            ...changedEditor(state.document, overrides.overrides),
            readOnly: undefined,
            report,
            set: (path, value) => {
              const { ended, text } = writtenOver(
                state.document,
                overrides.overrides,
                path,
                value,
              );
              write("config", text)
                .then(() => {
                  if (ended.length > 0) {
                    overrides.reset(ended);
                  }
                })
                .catch(report("Couldn't change the setting"));
            },
            temporary: false,
          }
        : temporaryEditor(state.document, overrides, report);
    case ConfigKind.None:
    case ConfigKind.Module:
      return temporaryEditor(state.document, overrides, report);
  }
};

/** An editor whose changes are temporary, laid over `document`. */
const temporaryEditor = (
  document: ConfigDocument,
  {
    overrides,
    set,
  }: Pick<ReturnType<typeof useConfigOverrides>, "overrides" | "set">,
  report: Report,
): ConfigEditor => {
  return {
    ...changedEditor(document, overrides),
    readOnly: undefined,
    report,
    set: (path, value) => {
      set(path, value).catch(report("Couldn't change the setting"));
    },
    temporary: true,
  };
};

/** `document` with `overrides` laid over it, and the settings it makes. */
const changedEditor = (
  document: ConfigDocument,
  overrides: readonly ConfigOverride[],
): Pick<ConfigEditor, "document" | "settings"> => {
  const changed = withOverrides(document, overrides);
  return {
    document: changed,
    settings: readSettings(changed).match({
      Err: (why) => {
        throw new Error(
          `The desktop took a change the form can't read: ${why}`,
        );
      },
      Ok: (settings) => settings,
    }),
  };
};

const layoutStyles = grid({
  backgroundColor: "background",
  blockSize: "100%",
  color: "foreground",
  gap: 0,
  gridTemplateColumns: "{spacing.60} minmax(0, 1fr)",
  overflow: "hidden",
});

const mainStyles = css({ overflowY: "auto" });

const failureStyles = vstack({
  alignItems: "stretch",
  marginInline: "auto",
  maxInlineSize: 200,
  paddingBlockStart: 6,
  paddingInline: 8,
});

const toastAreaStyles = css({
  inlineSize: 96,
  insetBlockStart: 4,
  insetInlineEnd: 4,
  position: "fixed",
  zIndex: "toast",
});

const toastStyles = vstack({
  alignItems: "flex-start",
  gap: 0.5,
  paddingBlock: 3,
  paddingInline: 4,
});

const toastTitleStyles = css({
  color: "foreground",
  fontSize: "sm",
  fontWeight: "semibold",
});

const toastDescriptionStyles = css({
  color: "muted",
  fontSize: "xs",
});
