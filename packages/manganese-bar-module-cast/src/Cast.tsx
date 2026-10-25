import { Button } from "@domicile-desktop/component-library/Button";
import { Popover } from "@domicile-desktop/component-library/Popover";
import type {
  CastBackend,
  Casting,
  CastTarget,
  Cast as Running,
} from "@domicile-desktop/sdk/cast";
import { CastMode } from "@domicile-desktop/sdk/cast";
import { TelevisionSimpleIcon } from "@phosphor-icons/react/dist/ssr/TelevisionSimple";
import { useEffect, useState } from "react";
import { css, cva } from "../styled-system/css";
import { flex, hstack } from "../styled-system/patterns";

type Props = {
  /** What finds TVs and sends to them. */
  backends: readonly CastBackend[];
  /** The desktop's casts. */
  casting: Casting;
};

/** A TV, with the backend that found it. */
type Found = { backend: CastBackend; key: string; target: CastTarget };

/**
 * The Cast item on the bar, shown while a TV is near or a cast runs. Its panel
 * lists the TVs; pick one to extend the desktop onto it or to cast what the
 * share picker picks. Lit while casting, when the panel stops each cast.
 */
export const Cast = ({ backends, casting }: Props) => {
  const found = useFound(backends);
  const casts = useCasts(casting);
  if (found.length === 0 && casts.length === 0) {
    return undefined;
  }
  const label = labelOf(casts);
  return (
    <Popover
      align="center"
      side="bottom"
      tone="overPhoto"
      trigger={
        <button
          aria-label={label}
          className={triggerStyles({ casting: casts.length > 0 })}
          title={label}
          type="button"
        >
          <TelevisionSimpleIcon size={15} weight="bold" />
        </button>
      }
      wide
    >
      <Panel
        casting={casting}
        casts={casts}
        found={found.filter(
          ({ backend, target }) =>
            !casts.some(
              (cast) =>
                cast.backend === backend && cast.target.id === target.id,
            ),
        )}
      />
    </Popover>
  );
};

/** The running casts, and the TVs to start one on. */
const Panel = ({
  casting,
  casts,
  found,
}: {
  casting: Casting;
  casts: readonly Running[];
  found: readonly Found[];
}) => {
  const [chosen, setChosen] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState<string | undefined>(undefined);
  const [failed, setFailed] = useState<
    { key: string; why: string } | undefined
  >(undefined);
  const start = ({ backend, key, target }: Found, mode: CastMode) => {
    setPending(key);
    setFailed(undefined);
    casting.start(backend, target, mode).then(
      (started) => {
        setPending(undefined);
        started.match({
          Err: (why) => {
            setFailed({ key, why });
          },
          Ok: () => {
            setChosen(undefined);
          },
        });
      },
      (error: unknown) => {
        setPending(undefined);
        // biome-ignore lint/suspicious/noConsole: surfacing a background failure
        console.error(`Failed to cast to ${target.name}`, error);
      },
    );
  };
  return (
    <div className={panelStyles}>
      {casts.length > 0 && (
        <ul className={listStyles}>
          {casts.map((cast) => (
            <li className={rowStyles} key={cast.target.id}>
              <span className={headStyles}>
                <span className={nameStyles}>{cast.target.name}</span>
                <span className={noteStyles}>{modeName(cast.mode)}</span>
              </span>
              <Button onClick={cast.stop} size="xs" variant="danger">
                Stop casting
              </Button>
            </li>
          ))}
        </ul>
      )}
      {found.length > 0 && (
        <ul aria-label="TVs" className={listStyles}>
          {found.map((tv) => (
            <li className={rowStyles} key={tv.key}>
              <button
                aria-expanded={chosen === tv.key}
                className={tvStyles}
                disabled={tv.target.unreachable !== undefined}
                onClick={() => {
                  setChosen(chosen === tv.key ? undefined : tv.key);
                }}
                type="button"
              >
                <span className={nameStyles}>{tv.target.name}</span>
                {tv.target.unreachable !== undefined && (
                  <span className={noteStyles}>{tv.target.unreachable}</span>
                )}
              </button>
              {chosen === tv.key && (
                <span className={choicesStyles}>
                  <Button
                    disabled={pending !== undefined}
                    loading={pending === tv.key}
                    onClick={() => {
                      start(tv, CastMode.Extend);
                    }}
                    size="xs"
                  >
                    Extend desktop
                  </Button>
                  <Button
                    disabled={pending !== undefined}
                    onClick={() => {
                      start(tv, CastMode.Pick);
                    }}
                    size="xs"
                    variant="outline"
                  >
                    Cast…
                  </Button>
                </span>
              )}
              {failed?.key === tv.key && (
                <span className={errorStyles}>{failed.why}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

/** Every backend's TVs, each keyed by its backend and id. */
const useFound = (backends: readonly CastBackend[]): readonly Found[] => {
  const [found, setFound] = useState<readonly (readonly Found[])[]>([]);
  useEffect(() => {
    const unwatch = backends.map((backend, index) =>
      backend.watchTargets((targets) => {
        setFound((was) =>
          backends.map((_, other) =>
            other === index
              ? targets.map((target) => ({
                  backend,
                  key: `${index}:${target.id}`,
                  target,
                }))
              : (was[other] ?? []),
          ),
        );
      }),
    );
    return () => {
      for (const stop of unwatch) {
        stop();
      }
    };
  }, [backends]);
  return found.flat();
};

const useCasts = (casting: Casting): readonly Running[] => {
  const [casts, setCasts] = useState<readonly Running[]>([]);
  useEffect(() => casting.watch(setCasts), [casting]);
  return casts;
};

const modeName = (mode: CastMode): string => {
  switch (mode) {
    case CastMode.Extend:
      return "Extended desktop";
    case CastMode.Pick:
      return "Casting";
  }
};

/** Its name and tooltip: what it casts to, if anything. */
const labelOf = (casts: readonly Running[]): string =>
  casts.length === 0
    ? "Cast to a TV"
    : `Casting to ${casts.map((cast) => cast.target.name).join(", ")}`;

// Not the library's `Button`: its ghost variant uses `muted` text, which is
// unreadable over the wallpaper. Matches the Bluetooth item.
const triggerStyles = cva({
  base: {
    _hover: {
      backgroundColor: "color-mix(in oklab, white 16%, transparent)",
    },
    alignItems: "center",
    backgroundColor: "transparent",
    blockSize: 7,
    borderRadius: "full",
    borderStyle: "none",
    color: "inherit",
    cursor: "pointer",
    display: "inline-flex",
    flexShrink: 0,
    inlineSize: 7,
    justifyContent: "center",
    padding: 0,
    transition: "background-color {durations.fast} {easings.default}",
  },
  variants: {
    casting: {
      false: {},
      true: { color: "accent" },
    },
  },
});

const panelStyles = flex({
  direction: "column",
  gap: 3,
  inlineSize: 80,
});

const listStyles = flex({
  direction: "column",
  gap: 2,
  listStyle: "none",
  margin: 0,
  maxBlockSize: "50vh",
  overflowY: "auto",
  padding: 0,
});

const rowStyles = hstack({
  flexWrap: "wrap",
  gap: 1.5,
});

const headStyles = flex({
  direction: "column",
  flex: "1 1 0",
  minInlineSize: 0,
});

// A row's whole width, so the TV is easy to hit.
const tvStyles = css({
  _disabled: { cursor: "default" },
  _hover: {
    _enabled: {
      backgroundColor: "color-mix(in oklab, currentcolor 12%, transparent)",
    },
  },
  backgroundColor: "transparent",
  borderRadius: "md",
  borderStyle: "none",
  color: "inherit",
  cursor: "pointer",
  display: "flex",
  flex: "1 1 100%",
  flexDirection: "column",
  font: "inherit",
  paddingBlock: 1,
  paddingInline: 2,
  textAlign: "start",
});

const choicesStyles = hstack({ gap: 1.5, paddingInlineStart: 2 });

const nameStyles = css({ overflowWrap: "anywhere" });

const noteStyles = css({ opacity: 0.75 });

// Under the row, across its width.
const errorStyles = css({ color: "warning", flexBasis: "100%" });
