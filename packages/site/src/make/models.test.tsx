import { describe, expect, it } from "bun:test";
import type { Domicile } from "@domicile-desktop/sdk/desktop/desktop";
import { act } from "@testing-library/react";

import { compileShell } from "./compile";
import type { Model } from "./models";
import { MODELS } from "./models";
import { previewDesktop } from "./preview-desktop";
import { PREVIEW_MODULES } from "./preview-modules";

describe("MODELS", () => {
  for (const model of MODELS) {
    it(`${model.label} draws every window`, async () => {
      const { root } = await start(model);

      expect(root.querySelectorAll("app[app-id]")).toHaveLength(4);
      root.remove();
    });

    it(`${model.label} launches the command typed in it`, async () => {
      const { domicile, root } = await start(model);
      const input = root.querySelector("input[name=command]");
      if (!(input instanceof HTMLInputElement)) {
        throw new Error("no command box");
      }

      input.value = "firefox";
      await act(() => {
        input.form?.requestSubmit();
        return Promise.resolve();
      });

      expect(domicile.windows.list.at(-1)?.title).toBe("firefox");
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

/** Runs `model` on the preview's desktop, in a root of its own. */
const start = async (
  model: Model,
): Promise<{ domicile: Domicile; root: HTMLElement }> => {
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
  return { domicile, root };
};
