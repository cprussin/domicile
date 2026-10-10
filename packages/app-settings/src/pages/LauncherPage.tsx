import { Card } from "@domicile-desktop/component-library/Card";

import { css } from "../../styled-system/css";
import type { ConfigPageProps } from "../config-editor";
import { DEFAULT_OMIT } from "../config-schema";
import { ListSetting } from "../ListSetting";
import { Page } from "../Page";

/** `files.omit`: the paths the launcher's file search leaves out. */
export const LauncherPage = ({
  description,
  editor,
  title,
}: ConfigPageProps) => {
  const { readOnly, set, settings } = editor;
  return (
    <Page description={description} readOnly={readOnly} title={title}>
      <Card title="Left out of the file search">
        <p className={hintStyles}>
          Patterns under your home folder, as in a .gitignore. A pattern
          starting with ! takes a path back; the last match wins. The default
          leaves out hidden files.
        </p>
        <ListSetting
          addButton="Add pattern"
          addLabel="Add a pattern"
          disabled={readOnly !== undefined}
          items={settings.files.omit}
          onChange={(omit) => {
            set(
              ["files", "omit"],
              omit.join("\n") === DEFAULT_OMIT.join("\n") ? undefined : omit,
            );
          }}
          placeholder="Downloads/**"
        />
      </Card>
    </Page>
  );
};

const hintStyles = css({ color: "muted", fontSize: "xs", margin: 0 });
