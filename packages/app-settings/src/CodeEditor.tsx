import { Button } from "@domicile-desktop/component-library/Button";
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/dist/ssr/ArrowCounterClockwise";
import { FloppyDiskIcon } from "@phosphor-icons/react/dist/ssr/FloppyDisk";
import type { KeyboardEvent } from "react";
import { useLayoutEffect, useRef, useState } from "react";

import { css } from "../styled-system/css";
import { flex, hstack } from "../styled-system/patterns";
import type { Edit } from "./editing";
import { indent, newline, outdent } from "./editing";
import type { HostFile } from "./host";
import { Notice } from "./Notice";

type Props = {
  file: HostFile;
  /** The text being edited, or `undefined` while it matches the file. */
  draft: string | undefined;
  onDraft: (draft: string | undefined) => void;
  onSave: (text: string) => void;
};

/**
 * A plain text editor for one file: line numbers, Tab and Shift+Tab indent,
 * Enter keeps the line's indentation, and Ctrl+S saves. Read-only when the
 * file is.
 */
export const CodeEditor = ({ draft, file, onDraft, onSave }: Props) => {
  const area = useRef<HTMLTextAreaElement>(null);
  const [selection, setSelection] = useState<
    { end: number; start: number } | undefined
  >(undefined);
  // The file's text when the draft started, to tell an edit elsewhere.
  const [base, setBase] = useState(file.text);
  const text = draft ?? file.text;
  const dirty = draft !== undefined && draft !== file.text;
  const changedOnDisk = dirty && base !== file.text;

  useLayoutEffect(() => {
    if (selection !== undefined && area.current !== null) {
      area.current.setSelectionRange(selection.start, selection.end);
    }
  }, [selection]);

  const apply = (edit: Edit) => {
    onDraft(edit.text);
    setSelection({ end: edit.end, start: edit.start });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const { selectionEnd, selectionStart, value } = event.currentTarget;
    const current = { end: selectionEnd, start: selectionStart, text: value };
    if ((event.ctrlKey || event.metaKey) && event.key === "s") {
      event.preventDefault();
      if (dirty && file.writable) {
        onSave(text);
      }
    } else if (event.key === "Tab" && file.writable) {
      event.preventDefault();
      apply(event.shiftKey ? outdent(current) : indent(current));
    } else if (event.key === "Enter" && file.writable) {
      event.preventDefault();
      apply(newline(current));
    }
  };

  return (
    <div className={editorStyles}>
      <div className={toolbarStyles}>
        <code className={pathStyles}>{file.path}</code>
        <span className={statusStyles}>{status(file.writable, dirty)}</span>
        {file.writable && (
          <>
            <Button
              beforeIcon={<ArrowCounterClockwiseIcon size={14} />}
              disabled={!dirty}
              onClick={() => {
                onDraft(undefined);
                setBase(file.text);
              }}
              size="sm"
              variant="ghost"
            >
              Revert
            </Button>
            <Button
              beforeIcon={<FloppyDiskIcon size={14} />}
              disabled={!dirty}
              onClick={() => {
                onSave(text);
              }}
              size="sm"
              variant="primary"
            >
              Save
            </Button>
          </>
        )}
      </div>
      {changedOnDisk && (
        <Notice tone="danger">
          The file changed on disk since you started editing. Saving replaces
          that change; Revert loads it.
        </Notice>
      )}
      <div className={scrollerStyles}>
        <pre aria-hidden className={gutterStyles}>
          {lineNumbers(text)}
        </pre>
        <textarea
          aria-label={file.path}
          autoCapitalize="off"
          autoComplete="off"
          className={areaStyles}
          onChange={(event) => {
            if (draft === undefined) {
              setBase(file.text);
            }
            onDraft(event.target.value);
          }}
          onKeyDown={onKeyDown}
          readOnly={!file.writable}
          ref={area}
          spellCheck={false}
          value={text}
          wrap="off"
        />
      </div>
    </div>
  );
};

const status = (writable: boolean, dirty: boolean) => {
  if (!writable) {
    return "Read-only";
  } else if (dirty) {
    return "Edited";
  } else {
    return "Saved";
  }
};

/** "1\n2\n…" for each line of `text`. */
const lineNumbers = (text: string) =>
  Array.from({ length: text.split("\n").length }, (_, at) => at + 1).join("\n");

const editorStyles = flex({
  backgroundColor: "card",
  border: "1px solid {colors.border}",
  borderRadius: "lg",
  direction: "column",
  gap: 0,
  overflow: "hidden",
});

const toolbarStyles = hstack({
  borderBlockEnd: "1px solid {colors.border}",
  gap: 2,
  paddingBlock: 2,
  paddingInline: 3,
});

const pathStyles = css({
  color: "muted",
  flexGrow: 1,
  fontFamily: "mono",
  fontSize: "xs",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

const statusStyles = css({ color: "textTertiary", fontSize: "xs" });

const scrollerStyles = flex({
  alignItems: "flex-start",
  gap: 0,
  maxBlockSize: 160,
  minBlockSize: 80,
  overflow: "auto",
});

const gutterStyles = css({
  backgroundColor: "color-mix(in oklab, {colors.foreground} 3%, transparent)",
  borderInlineEnd: "1px solid {colors.border}",
  color: "textTertiary",
  flexShrink: 0,
  fontFamily: "mono",
  fontSize: "xs",
  insetInlineStart: 0,
  lineHeight: "relaxed",
  margin: 0,
  minBlockSize: "100%",
  paddingBlock: 3,
  paddingInline: 3,
  position: "sticky",
  textAlign: "end",
  userSelect: "none",
});

const areaStyles = css({
  backgroundColor: "transparent",
  border: "none",
  color: "foreground",
  fieldSizing: "content",
  flexGrow: 1,
  fontFamily: "mono",
  fontSize: "xs",
  lineHeight: "relaxed",
  margin: 0,
  minBlockSize: 80,
  minInlineSize: 0,
  outline: "none",
  paddingBlock: 3,
  paddingInline: 3,
  resize: "none",
  tabSize: 2,
  whiteSpace: "pre",
});
