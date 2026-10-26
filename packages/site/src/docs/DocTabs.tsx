"use client";

import { Tabs } from "@domicile-desktop/component-library/Tabs";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

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

  return (
    <Tabs
      onValueChange={(picked) => {
        const label = String(picked);
        setValue(label);
        store(label);
        window.dispatchEvent(new CustomEvent(PICKED, { detail: label }));
      }}
      tabs={tabs.map((tab) => ({
        content: tab.content,
        label: tab.label,
        value: tab.label,
      }))}
      value={value}
    />
  );
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
