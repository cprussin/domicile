"use client";

import type { Result } from "@cprussin/option-result";
import { Button } from "@domicile-desktop/component-library/Button";
import { ModalDialog } from "@domicile-desktop/component-library/ModalDialog";
import { Tabs } from "@domicile-desktop/component-library/Tabs";
import type { Shell } from "@domicile-desktop/sdk/shell";
import { useEffect, useState } from "react";

import { css } from "../../styled-system/css";
import { flex, hstack } from "../../styled-system/patterns";
import { CodeEditor } from "./CodeEditor";
import { compileShell } from "./compile";
import { Hint } from "./Hint";
import { MODELS } from "./models";
import { Preview } from "./Preview";
import { PREVIEW_MODULES } from "./preview-modules";

/** How long typing pauses before the preview runs the code again. */
const SETTLE_MS = 350;

/** The file the download saves, and the command that runs it. */
const FILE = "my-desktop.tsx";

/**
 * "Make your own desktop": pick a window model, change its code, watch it run
 * on a stand-in desktop, then download it to run for real.
 */
export const Builder = () => {
  const [model, setModel] = useState(MODELS[0]);
  const [edits, setEdits] = useState<Readonly<Record<string, string>>>({});
  const [view, setView] = useState("preview");
  const [compiled, setCompiled] = useState<
    { shell: Result<Shell, string>; run: number } | undefined
  >(undefined);
  const code = edits[model.id] ?? model.code;

  useEffect(() => {
    const settled = setTimeout(() => {
      setCompiled((last) => ({
        run: (last?.run ?? 0) + 1,
        shell: compileShell(code, PREVIEW_MODULES),
      }));
    }, SETTLE_MS);
    return () => {
      clearTimeout(settled);
    };
  }, [code]);

  return (
    <div className={builderStyles}>
      <div className={modelsStyles}>
        {MODELS.map((each) => (
          <Button
            aria-pressed={each === model}
            key={each.id}
            onClick={() => {
              setModel(each);
            }}
            variant={each === model ? "accent" : "outline"}
          >
            {each.label}
          </Button>
        ))}
      </div>
      <div className={viewStyles}>
        <Tabs
          onValueChange={(value: string) => {
            setView(value);
          }}
          tabs={[
            {
              content: (
                <Preview
                  run={compiled?.run ?? 0}
                  shell={compiled?.shell.match<Shell | undefined>({
                    Err: () => undefined,
                    Ok: (shell) => shell,
                  })}
                />
              ),
              label: "Preview",
              value: "preview",
            },
            {
              content: (
                <CodeEditor
                  label="Your desktop's code"
                  onChange={(changed) => {
                    setEdits((all) => ({ ...all, [model.id]: changed }));
                  }}
                  value={code}
                />
              ),
              label: "Code",
              value: "code",
            },
          ]}
          value={view}
        />
        <p className={statusStyles} role="status">
          {compiled?.shell.match({
            Err: (error) => error,
            Ok: () => "Running",
          })}
        </p>
      </div>
      <Hint text={model.hint} />
      <div className={actionsStyles}>
        <RunForReal code={code} />
        <CopyPrompt code={code} />
      </div>
    </div>
  );
};

/** Downloads the file, with how to run it. */
const RunForReal = ({ code }: { code: string }) => (
  <ModalDialog
    footer={
      <Button
        onClick={() => {
          download(code);
        }}
        variant="accent"
      >
        {`Download ${FILE}`}
      </Button>
    }
    title="Run it for real"
    trigger={<Button variant="accent">Run it for real</Button>}
  >
    <ol className={stepsStyles}>
      <li>
        Download <code className={codeStyles}>{FILE}</code>. It's yours to
        change, by hand or with a coding agent.
      </li>
      <li>
        <a className={linkStyles} href="/docs/install">
          Install Domicile
        </a>{" "}
        with your Linux distribution's package manager.
      </li>
      <li>
        Try it in a window on the desktop you're using now:
        <pre className={commandStyles}>
          <code>{`domicile ~/Downloads/${FILE}`}</code>
        </pre>
      </li>
      <li>To make it your desktop, pick Domicile when you log in.</li>
    </ol>
  </ModalDialog>
);

const COPY_LABELS = {
  copied: "Copied",
  failed: "Copy failed",
  idle: "Copy a prompt for your coding agent",
};

/** Copies a prompt that starts a coding agent on this desktop. */
const CopyPrompt = ({ code }: { code: string }) => {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <Button
      onClick={() => {
        navigator.clipboard
          .writeText(agentPrompt(code))
          .then(() => {
            setState("copied");
          })
          .catch(() => {
            setState("failed");
          });
      }}
      variant="outline"
    >
      {COPY_LABELS[state]}
    </Button>
  );
};

/** A prompt that gives an agent Domicile's docs and the person's file. */
const agentPrompt = (code: string): string =>
  `I'm making my own desktop with Domicile, a Linux desktop whose shell is a web page. Read https://domicile-desktop.com/llms.txt first.

Here's my desktop so far, ${FILE}. It's React and Tailwind, and \`domicile ./${FILE}\` runs it.

\`\`\`tsx
${code}\`\`\`

Help me change it. Here's what I want: `;

/** Saves `code` as the person's own file. */
const download = (code: string) => {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([code], { type: "text/plain" }));
  link.download = FILE;
  link.click();
  URL.revokeObjectURL(link.href);
};

const builderStyles = flex({ direction: "column", gap: 4 });

const modelsStyles = flex({ gap: 2, wrap: "wrap" });

const viewStyles = css({ position: "relative" });

// Beside the tabs, so it shows on both.
const statusStyles = css({
  color: "muted",
  fontFamily: "code",
  fontSize: "sm",
  insetBlockStart: 2,
  insetInlineEnd: 0,
  maxInlineSize: "60%",
  position: "absolute",
  textAlign: "end",
});

const actionsStyles = hstack({ flexWrap: "wrap", gap: 3 });

const stepsStyles = flex({
  direction: "column",
  gap: 3,
  listStyle: "decimal",
  paddingInlineStart: 5,
});

const codeStyles = css({ fontFamily: "code" });

const commandStyles = css({
  backgroundColor: "syntax.ground",
  borderRadius: "md",
  color: "syntax.plain",
  fontFamily: "code",
  fontSize: "sm",
  marginBlockStart: 2,
  overflowX: "auto",
  paddingBlock: 2,
  paddingInline: 3,
});

const linkStyles = css({ color: "accent", textDecoration: "underline" });
