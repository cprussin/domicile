// The desktop for a component's tests.
//
// ```tsx
// const fake = new FakeDomicileHost();
// render(<FakeDomicile fake={fake}><Taskbar /></FakeDomicile>);
// act(() => fake.appear("term", { title: "Terminal" }));
// ```

import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import type { ReactNode } from "react";
import { useState } from "react";

import { DomicileProvider } from "./domicile-provider";

/**
 * Hands the components below `fake`'s desktop, which the test sets state on
 * and reads calls from. Without `fake`, a desktop no test drives.
 */
export const FakeDomicile = ({
  children,
  fake,
}: {
  children: ReactNode;
  fake?: FakeDomicileHost | undefined;
}) => {
  const [own] = useState(() => new FakeDomicileHost());
  return (
    <DomicileProvider domicile={(fake ?? own).domicile}>
      {children}
    </DomicileProvider>
  );
};
