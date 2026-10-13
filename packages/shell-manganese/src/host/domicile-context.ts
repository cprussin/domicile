import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";
import { createContext } from "react";

import { useProvided } from "./use-provided";

/** The desktop the chrome runs on, for parts that call it themselves. */
export const DomicileContext = createContext<DomicileHost | undefined>(
  undefined,
);

/** The desktop from {@link DomicileContext}. */
export const useDomicile = (): DomicileHost =>
  useProvided(DomicileContext, "the desktop (DomicileContext)");
