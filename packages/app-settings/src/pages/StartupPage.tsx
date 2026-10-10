import { Button } from "@domicile-desktop/component-library/Button";
import { Card } from "@domicile-desktop/component-library/Card";
import { Input } from "@domicile-desktop/component-library/Input";
import { PlusIcon } from "@phosphor-icons/react/dist/ssr/Plus";
import { XIcon } from "@phosphor-icons/react/dist/ssr/X";
import { useState } from "react";

import { css } from "../../styled-system/css";
import { flex, grid } from "../../styled-system/patterns";
import { joinArgv, splitArgv } from "../argv";
import type { ConfigPageProps } from "../config-editor";
import { Page } from "../Page";
import { TextSetting } from "../TextSetting";

/** `startup.commands`: argvs run once at startup, each typed as one line. */
export const StartupPage = ({
  description,
  editor,
  title,
}: ConfigPageProps) => {
  const { readOnly, report, set, settings } = editor;
  const { commands } = settings.startup;
  const disabled = readOnly !== undefined;
  const [adding, setAdding] = useState("");
  const add = () => {
    splitArgv(adding).match({
      Err: report("Not a command"),
      Ok: (argv) => {
        set(["startup", "commands"], [...commands, argv]);
        setAdding("");
      },
    });
  };
  return (
    <Page description={description} readOnly={readOnly} title={title}>
      <Card>
        <p className={hintStyles}>
          Read when the desktop starts. No shell runs them: to use one, write sh
          -c "…". Quote an argument that holds spaces.
        </p>
        <ol className={listStyles}>
          {commands.map((argv, index) => (
            <li className={itemStyles} key={`${index}-${argv.join(" ")}`}>
              <TextSetting
                disabled={disabled}
                label={`Command ${index + 1}`}
                onCommit={(line) =>
                  splitArgv(line).match({
                    Err: (why) => {
                      report("Not a command")(why);
                      return false;
                    },
                    Ok: (edited) => {
                      set(["startup", "commands", index], edited);
                      return true;
                    },
                  })
                }
                value={joinArgv(argv)}
                width={120}
              />
              {!disabled && (
                <Button
                  label={`Remove command ${index + 1}`}
                  onClick={() => {
                    set(
                      ["startup", "commands"],
                      commands.length === 1
                        ? undefined
                        : commands.toSpliced(index, 1),
                    );
                  }}
                  size="sm"
                  variant="ghost"
                >
                  <XIcon size={14} />
                </Button>
              )}
            </li>
          ))}
        </ol>
        {!disabled && (
          <div className={addStyles}>
            <Input
              aria-label="Add a command"
              onChange={(event) => {
                setAdding(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  add();
                }
              }}
              placeholder="emacs --daemon"
              size="sm"
              value={adding}
            />
            <Button
              beforeIcon={<PlusIcon size={14} />}
              onClick={add}
              size="sm"
              variant="outline"
            >
              Add command
            </Button>
          </div>
        )}
      </Card>
    </Page>
  );
};

const hintStyles = css({ color: "muted", fontSize: "xs", margin: 0 });

const listStyles = flex({
  direction: "column",
  gap: 2,
  listStyle: "none",
  margin: 0,
  padding: 0,
});

const itemStyles = flex({ align: "center", gap: 2 });

const addStyles = grid({
  alignItems: "center",
  gap: 2,
  gridTemplateColumns: "minmax(0, 1fr) auto",
});
