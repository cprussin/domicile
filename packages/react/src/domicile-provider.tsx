// The desktop a shell or app is handed, as React context.

import type { AppDomicile } from "@domicile-desktop/sdk/desktop/app-desktop";
import type { Domicile } from "@domicile-desktop/sdk/desktop/desktop";
import type { ReactNode } from "react";
import { createContext, useContext } from "react";

const DomicileContext = createContext<Domicile | AppDomicile | undefined>(
  undefined,
);

/** Hands `domicile` to every hook below. `mount` renders one for you. */
export const DomicileProvider = ({
  children,
  domicile,
}: {
  children: ReactNode;
  domicile: Domicile | AppDomicile;
}) => <DomicileContext value={domicile}>{children}</DomicileContext>;

/** A shell's desktop, from the provider above. Throws under an app's. */
export const useDomicile = (): Domicile => {
  const domicile = useProvided("useDomicile");
  if (isShells(domicile)) {
    return domicile;
  } else {
    throw new Error(
      "useDomicile: the desktop above is an app's; use useAppDomicile",
    );
  }
};

/** The desktop above as an app has it: a shell's has all of it too. */
export const useAppDomicile = (): AppDomicile => useProvided("useAppDomicile");

const useProvided = (hook: string): Domicile | AppDomicile => {
  const domicile = useContext(DomicileContext);
  if (domicile === undefined) {
    throw new Error(`${hook}: no <DomicileProvider> above`);
  } else {
    return domicile;
  }
};

// Only a shell's desktop manages windows.
const isShells = (domicile: Domicile | AppDomicile): domicile is Domicile =>
  "windows" in domicile;
