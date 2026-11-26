// Temporary changes to a config the desktop cannot write: laid over it in the
// compositor until the desktop restarts or the config changes that setting.
// See docs/SETTINGS.md#temporary-changes.

import { Button } from "@domicile-desktop/component-library/Button";
import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

import { flex } from "../styled-system/patterns";
import type { ConfigDocument, ConfigPath } from "./config-document";
import { withValue } from "./config-document";
import type { ConfigOverride, SettingsHost } from "./host";

/** What a page knows of the temporary changes. */
export type TemporaryChanges = {
  /** Every temporary change, in the order they were made. */
  overrides: readonly ConfigOverride[];
  /** Ends the changes at or under each of `paths`. */
  reset: (paths: readonly ConfigPath[]) => void;
  /**
   * Lays `value` over the config at `path` for now, whether or not the page
   * writes the file: what puts back one of the tray's switches and keeps
   * the rest. Resolves once the desktop has it.
   */
  setForNow: (path: ConfigPath, value: unknown) => Promise<void>;
  /** The config sections the page shows. */
  sections: readonly ConfigPath[];
  /**
   * Whether a change made here is temporary: `false` for a config the page
   * writes, which shows the changes the shell or the tray made over it.
   */
  temporary: boolean;
};

const TemporaryChangesContext = createContext<TemporaryChanges | undefined>(
  undefined,
);

type ProviderProps = {
  /** `undefined` for a config the form cannot read. */
  changes: TemporaryChanges | undefined;
  children: ReactNode;
};

/** Gives a page's rows and notice the temporary changes. */
export const TemporaryChangesProvider = ({
  changes,
  children,
}: ProviderProps) => (
  <TemporaryChangesContext.Provider value={changes}>
    {children}
  </TemporaryChangesContext.Provider>
);

/** The temporary changes, or `undefined` where the config is unreadable. */
export const useTemporaryChanges = () => useContext(TemporaryChangesContext);

/** The desktop's temporary changes, read again whenever a file changes. */
export const useConfigOverrides = (host: SettingsHost) => {
  const [overrides, setOverrides] = useState<readonly ConfigOverride[]>([]);
  const [failure, setFailure] = useState<unknown>(undefined);
  const settle = useCallback((asked: Promise<ConfigOverride[]>) => {
    asked.then(
      (changes) => {
        setOverrides(changes);
        setFailure(undefined);
      },
      (error: unknown) => {
        setFailure(error);
      },
    );
  }, []);
  useEffect(() => {
    const reload = () => {
      settle(host.configOverrides());
    };
    reload();
    return host.onChange(reload);
  }, [host, settle]);
  const set = useCallback(
    async (path: ConfigPath, value: unknown) => {
      setOverrides(await host.setConfigOverride(path, value));
    },
    [host],
  );
  const reset = useCallback(
    (paths: readonly ConfigPath[]) => {
      settle(host.resetConfigOverrides(paths));
    },
    [host, settle],
  );
  return { failure, overrides, reset, set };
};

/** `document` with each of `overrides` laid over it, in order. */
export const withOverrides = (
  document: ConfigDocument,
  overrides: readonly ConfigOverride[],
): ConfigDocument =>
  overrides.reduce(
    (changed, { path, value }) =>
      withValue(changed, path, value === null ? undefined : value),
    document,
  );

/** The changes at or under any of `paths`. */
export const changesUnder = (
  overrides: readonly ConfigOverride[],
  paths: readonly ConfigPath[],
): ConfigOverride[] =>
  overrides.filter(({ path }) =>
    paths.some((under) => under.every((key, at) => path[at] === key)),
  );

/** That a temporary change differs from the config at `path`, and Reset. */
export const Changed = ({
  path,
  title,
}: {
  path: ConfigPath;
  title: string;
}) => {
  const changes = useTemporaryChanges();
  return changes === undefined ||
    changesUnder(changes.overrides, [path]).length === 0 ? undefined : (
    <span className={changedStyles}>
      <span>Changed from your config</span>
      <Button
        label={`Reset ${title}`}
        onClick={() => {
          changes.reset([path]);
        }}
        size="xs"
        variant="ghost"
      >
        Reset
      </Button>
    </span>
  );
};

const changedStyles = flex({
  alignItems: "center",
  color: "warning",
  fontSize: "xs",
  gap: 1.5,
});
