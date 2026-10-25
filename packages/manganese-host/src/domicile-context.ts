import type { Domicile } from "@domicile-desktop/sdk/desktop/desktop";
import { createContext } from "react";

import { useProvided } from "./use-provided";

/** The desktop the chrome runs on, for parts that call it themselves. */
export const DomicileContext = createContext<Domicile | undefined>(undefined);

/** The desktop from {@link DomicileContext}. */
export const useDomicile = (): Domicile =>
  useProvided(DomicileContext, "the desktop (DomicileContext)");
