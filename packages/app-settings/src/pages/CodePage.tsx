import { Tabs } from "@domicile-desktop/component-library/Tabs";
import { useState } from "react";

import { css } from "../../styled-system/css";
import { CodeEditor } from "../CodeEditor";
import type { Report } from "../config-editor";
import type { HostFile, SettingsFiles, Target } from "../host";
import { Page } from "../Page";

type Props = {
  title: string;
  description: string;
  files: SettingsFiles;
  write: (file: Target, text: string) => Promise<void>;
  report: Report;
};

/** The config and the shell as code, each in an editor. */
export const CodePage = ({
  description,
  files,
  report,
  title,
  write,
}: Props) => {
  // Kept here so switching tabs keeps an unsaved edit.
  const [drafts, setDrafts] = useState<
    Readonly<Partial<Record<Target, string>>>
  >({});
  const editor = (target: Target, file: HostFile | undefined, none: string) =>
    file === undefined ? (
      <p className={noneStyles}>{none}</p>
    ) : (
      <CodeEditor
        draft={drafts[target]}
        file={file}
        onDraft={(draft) => {
          setDrafts((current) => ({ ...current, [target]: draft }));
        }}
        onSave={(text) => {
          write(target, text).then(() => {
            setDrafts((current) => ({ ...current, [target]: undefined }));
          }, report("Couldn't save"));
        }}
      />
    );
  return (
    <Page description={description} title={title}>
      <Tabs
        defaultValue="config"
        tabs={[
          {
            content: editor(
              "config",
              files.config,
              "This desktop has no config file, so it runs the defaults.",
            ),
            label: "Config",
            value: "config",
          },
          {
            content: editor(
              "shell",
              files.shell,
              "This desktop's shell is a package, which has no file to edit here.",
            ),
            label: "Shell",
            value: "shell",
          },
        ]}
      />
    </Page>
  );
};

const noneStyles = css({ color: "muted", fontSize: "sm", paddingBlock: 4 });
