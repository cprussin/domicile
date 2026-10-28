import { describe, expect, it } from "bun:test";
import { act } from "@testing-library/react";

import { compileShell } from "./compile";
import { MODELS } from "./models";
import { previewDesktop } from "./preview-desktop";
import { PREVIEW_MODULES } from "./preview-modules";

describe("MODELS", () => {
  for (const model of MODELS) {
    it(`${model.label} draws every window`, async () => {
      const root = document.createElement("div");
      document.body.append(root);
      const { domicile } = previewDesktop();

      // Async, so a nested shell's start, after React's commit, runs too.
      await act(() => {
        compileShell(model.code, PREVIEW_MODULES).match({
          Err: (error) => {
            throw new Error(error);
          },
          Ok: (shell) => shell(root, domicile),
        });
        return Promise.resolve();
      });

      expect(root.querySelectorAll("app[app-id]")).toHaveLength(4);
      root.remove();
    });
  }

  // The download runs as is: Tailwind is an npm package, not a build step.
  it("each styles itself with Tailwind's in-browser build", () => {
    for (const model of MODELS) {
      expect(model.code).toContain('\nimport "@tailwindcss/browser";\n');
    }
  });
});
