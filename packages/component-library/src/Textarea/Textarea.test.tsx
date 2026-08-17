import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { createRef } from "react";

import { runControlSuite } from "../__test__/runControlSuite";

import { Textarea } from "./Textarea";

describe(Textarea, () => {
  runControlSuite({ Component: Textarea, defaultLabel: "Bio" });

  describe("textarea-specific prop forwarding", () => {
    it("forwards arbitrary HTML attributes (rows, maxLength, name)", () => {
      render(<Textarea aria-label="Bio" maxLength={120} name="bio" rows={6} />);
      const textarea = screen.getByRole("textbox");
      expect(textarea).toHaveAttribute("name", "bio");
      expect(textarea).toHaveAttribute("maxlength", "120");
      expect(textarea).toHaveAttribute("rows", "6");
    });

    it("applies the numeric height props as inline block-size styles", () => {
      render(
        <Textarea aria-label="Bio" height={40} maxHeight={80} minHeight={20} />,
      );
      const textarea = screen.getByRole("textbox");
      expect(textarea.style.blockSize).toBe("10rem");
      expect(textarea.style.minBlockSize).toBe("5rem");
      expect(textarea.style.maxBlockSize).toBe("20rem");
    });
  });

  describe("resize handle", () => {
    it("renders the resize handle by default", () => {
      const { container } = render(<Textarea aria-label="Bio" />);
      expect(container.querySelector("[data-resize-handle]")).not.toBeNull();
    });

    it("does not render the resize handle when disableResize is set", () => {
      const { container } = render(<Textarea aria-label="Bio" disableResize />);
      expect(container.querySelector("[data-resize-handle]")).toBeNull();
    });

    it("does not render the resize handle when autoSize is set", () => {
      const { container } = render(<Textarea aria-label="Bio" autoSize />);
      expect(container.querySelector("[data-resize-handle]")).toBeNull();
    });
  });

  describe("autoSize", () => {
    it("writes an inline blockSize matching the rendered scrollHeight", () => {
      render(<Textarea aria-label="Bio" autoSize defaultValue="hello" />);
      const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
      // The layout effect sets blockSize to `${scrollHeight}px` after the
      // first commit. In test environments scrollHeight may be 0 (no layout
      // engine), but the style should still be set to a px value rather
      // than an empty string.
      expect(textarea.style.blockSize).toMatch(/^\d+px$/);
    });

    it("ignores an explicit height prop when autoSize is set", () => {
      render(<Textarea aria-label="Bio" autoSize height={40} />);
      const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
      // The `height` prop would normally render as `blockSize: 10rem`, but
      // autoSize owns blockSize via the layout effect — so the rem value
      // must not appear on the element.
      expect(textarea.style.blockSize).not.toBe("10rem");
    });

    it("still applies maxHeight as a ceiling when autoSize is set", () => {
      render(<Textarea aria-label="Bio" autoSize maxHeight={60} />);
      const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
      expect(textarea.style.maxBlockSize).toBe("15rem");
    });
  });

  describe("ref forwarding", () => {
    it("populates a caller-supplied ref with the underlying textarea element", () => {
      const ref = createRef<HTMLTextAreaElement>();
      render(<Textarea aria-label="Bio" ref={ref} />);
      expect(ref.current).toBe(screen.getByRole("textbox"));
    });

    it("invokes a callback ref with the underlying textarea element", () => {
      const captured: { current: HTMLTextAreaElement | null } = {
        current: null,
      };
      render(
        <Textarea
          aria-label="Bio"
          ref={(el) => {
            captured.current = el;
          }}
        />,
      );
      expect(captured.current).toBe(screen.getByRole("textbox"));
    });
  });
});
