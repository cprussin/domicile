"use client";

import { Tabs } from "@domicile-desktop/component-library/Tabs";
import type { ReactNode, RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { css } from "../../styled-system/css";

type Props = {
  /** Each tab's label, which is also what the reader's pick remembers. */
  tabs: readonly { label: string; content: ReactNode }[];
};

/** Where the reader's pick is kept, and the event that tells other tab sets. */
const KEY = "docs-tab:v1";
const PICKED = "docs-tab-picked";

/**
 * A docs page's tabs, such as "Settings app" and "Config file". Picking a tab
 * picks the same label in every tab set on the site, now and on later pages.
 */
export const DocTabs = ({ tabs }: Props) => {
  const labels = tabs.map((tab) => tab.label);
  const [value, setValue] = useState(labels[0]);
  // One string, so the effect runs again only if the labels change.
  const named = labels.join("\n");
  const frame = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const follow = (label: string | null) => {
      if (label !== null && named.split("\n").includes(label)) {
        setValue(label);
      }
    };
    follow(stored());
    const picked = (event: Event) => {
      follow((event as CustomEvent<string>).detail);
    };
    window.addEventListener(PICKED, picked);
    return () => {
      window.removeEventListener(PICKED, picked);
    };
  }, [named]);

  // A plain block around the tabs, which fill their parent's height and may
  // shrink below their content: a docs page's flex column would squeeze them,
  // and the panel's code would overlap what follows.
  return (
    <div className={frameStyles} ref={frame}>
      <Tabs
        onValueChange={(picked) => {
          const label = String(picked);
          store(label);
          // Every set on the page follows a pick, so one above can change
          // height and push these down. Scroll by as much, so the tabs stay
          // under the pointer.
          const before = topOf(frame);
          flushSync(() => {
            setValue(label);
            window.dispatchEvent(new CustomEvent(PICKED, { detail: label }));
          });
          window.scrollBy({ behavior: "instant", top: topOf(frame) - before });
        }}
        tabs={tabs.map((tab) => ({
          content: tab.content,
          label: tab.label,
          value: tab.label,
        }))}
        value={value}
      />
    </div>
  );
};

/** The top of the mounted element in `ref`, on screen. */
const topOf = (ref: RefObject<HTMLElement | null>): number => {
  if (ref.current === null) {
    throw new Error("The tabs are not mounted.");
  }
  return ref.current.getBoundingClientRect().top;
};

// Storage can be missing or refuse, as in a private window: the tabs then
// just start on the first.
const stored = (): string | null => {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
};

const store = (label: string) => {
  try {
    window.localStorage.setItem(KEY, label);
  } catch {
    // Not remembered; this page's tabs still follow.
  }
};

// The panel's first line clear of the tab bar.
const frameStyles = css({
  "& [role=tabpanel]": { paddingBlockStart: 4 },
  // The browser's own scroll anchoring would fight the scroll above.
  overflowAnchor: "none",
});
