import { describe, expect, it } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import type { RefObject } from "react";

import { ResizeHandle } from "./ResizeHandle";

describe(ResizeHandle, () => {
  it("updates the textarea block-size as the mouse moves", () => {
    const { handle, textarea, unmount } = setupHandle();
    fireEvent.mouseDown(handle, { clientY: 100 });
    fireEvent.mouseMove(document, { clientY: 150 });
    expect(textarea.style.blockSize).toBe("150px");
    fireEvent.mouseMove(document, { clientY: 200 });
    expect(textarea.style.blockSize).toBe("200px");
    fireEvent.mouseUp(document);
    unmount();
  });

  it("ignores resize attempts when the textarea is disabled", () => {
    const { handle, textarea, unmount } = setupHandle({ disabled: true });
    fireEvent.mouseDown(handle, { clientY: 100 });
    fireEvent.mouseMove(document, { clientY: 150 });
    expect(textarea.style.blockSize).toBe("");
    unmount();
  });

  it("restores the body cursor after the drag ends", () => {
    document.body.style.cursor = "auto";
    const { handle, unmount } = setupHandle();
    fireEvent.mouseDown(handle, { clientY: 100 });
    expect(document.body.style.cursor).toBe("ns-resize");
    fireEvent.mouseUp(document);
    expect(document.body.style.cursor).toBe("auto");
    unmount();
  });

  it("restores the body cursor when unmounted mid-drag", () => {
    document.body.style.cursor = "auto";
    const { handle, unmount } = setupHandle();
    fireEvent.mouseDown(handle, { clientY: 100 });
    expect(document.body.style.cursor).toBe("ns-resize");
    unmount();
    expect(document.body.style.cursor).toBe("auto");
  });

  it("does not re-apply the drag-start cursor on a post-drag unmount", () => {
    document.body.style.cursor = "auto";
    const { handle, unmount } = setupHandle();
    // Drag and end normally.
    fireEvent.mouseDown(handle, { clientY: 100 });
    fireEvent.mouseUp(document);
    // Something else (e.g. another component) now sets the cursor.
    document.body.style.cursor = "wait";
    // Unmount should not re-apply the captured "auto" from drag-start.
    unmount();
    expect(document.body.style.cursor).toBe("wait");
  });
});

type Setup = {
  textarea: HTMLTextAreaElement;
  handle: Element;
  unmount: () => void;
};

const setupHandle = (
  options: { disabled?: boolean; rounded?: boolean } = {},
): Setup => {
  const textarea = document.createElement("textarea");
  if (options.disabled === true) {
    textarea.disabled = true;
  }
  Object.defineProperty(textarea, "offsetHeight", {
    configurable: true,
    value: 100,
  });
  document.body.append(textarea);
  const textareaRef: RefObject<HTMLTextAreaElement | null> = {
    current: textarea,
  };

  const { container, unmount } = render(
    <ResizeHandle
      disabled={options.disabled ?? false}
      rounded={options.rounded ?? false}
      textareaRef={textareaRef}
    />,
  );
  const handle = container.querySelector("[data-resize-handle]");
  if (handle === null) {
    throw new Error("expected resize handle to render");
  } else {
    return {
      handle,
      textarea,
      unmount: () => {
        unmount();
        textarea.remove();
      },
    };
  }
};
