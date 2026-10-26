// Sugar over <DomicileProvider> for a shell's `Shell` or an app's `main`.

import type { AppDomicile } from "@domicile-desktop/sdk/desktop/app-desktop";
import type { Domicile } from "@domicile-desktop/sdk/desktop/desktop";
import type { ComponentType } from "react";
import { StrictMode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import { DomicileProvider } from "./domicile-provider";
import { FailureBoundary } from "./failure-boundary";

/**
 * A `Shell` or `main` that draws `App` with the desktop it is handed, in
 * strict mode, showing an error in its place if it throws.
 *
 * ```ts
 * export const Shell: ShellModule = mount(Desktop);
 * ```
 */
export const mount =
  (App: ComponentType) =>
  (root: HTMLElement, domicile: Domicile | AppDomicile): void => {
    // An element of its own: the page reports failures by appending to
    // `root`, and a React root there would erase them. It draws no box, so
    // the app sizes against `root` and nothing is positioned against it.
    const element = root.ownerDocument.createElement("div");
    element.style.display = "contents";
    root.append(element);
    const reactRoot = createRoot(element);
    // Synchronously: the page draws nothing until `Shell` returns.
    flushSync(() => {
      reactRoot.render(
        <StrictMode>
          <FailureBoundary>
            <DomicileProvider domicile={domicile}>
              <App />
            </DomicileProvider>
          </FailureBoundary>
        </StrictMode>,
      );
    });
  };
