import { Button } from "@domicile-desktop/component-library/Button";
import { List, ListRow } from "@domicile-desktop/component-library/ListRow";
import { Panel } from "@domicile-desktop/component-library/Panel";
import { PanelNote } from "@domicile-desktop/component-library/PanelNote";
import { PanelSection } from "@domicile-desktop/component-library/PanelSection";
import { Popover } from "@domicile-desktop/component-library/Popover";
import { Tooltip } from "@domicile-desktop/component-library/Tooltip";
import type {
  CastBackend,
  Casting,
  CastTarget,
  Cast as Running,
} from "@domicile-desktop/sdk/cast";
import { CastMode } from "@domicile-desktop/sdk/cast";
import { TelevisionSimpleIcon } from "@phosphor-icons/react/dist/ssr/TelevisionSimple";
import { useEffect, useState } from "react";
import { css } from "../styled-system/css";

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
 * lists the running casts, each with a button to stop it, and the TVs nearby,
 * each with buttons to extend the desktop onto it or to cast what the share
 * picker picks.
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
      tooltip={label}
      trigger={
        <button aria-label={label} className={triggerStyles} type="button">
          <TelevisionSimpleIcon size={15} weight="bold" />
        </button>
      }
      wide
    >
      <CastPanel
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
const CastPanel = ({
  casting,
  casts,
  found,
}: {
  casting: Casting;
  casts: readonly Running[];
  found: readonly Found[];
}) => {
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
          Ok: () => undefined,
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
    <Panel title="Cast" width="standard">
      {casts.length > 0 && (
        <PanelSection label="Casting">
          <List>
            {casts.map((cast) => (
              <ListRow
                detail={modeName(cast.mode)}
                end={
                  <Button onClick={cast.stop} size="xs" variant="primary">
                    Stop
                  </Button>
                }
                icon={<TelevisionSimpleIcon size={15} weight="bold" />}
                key={cast.target.id}
                label={cast.target.name}
                surface="filled"
              />
            ))}
          </List>
        </PanelSection>
      )}
      {found.length > 0 && (
        <PanelSection label="TVs nearby">
          <List>
            {found.map((tv) => (
              <ListRow
                detail={tv.target.unreachable ?? "Ready"}
                end={
                  tv.target.unreachable === undefined && (
                    <>
                      <Tooltip
                        content="Use the TV as another screen"
                        tone="overPhoto"
                        trigger={
                          <Button
                            disabled={pending !== undefined}
                            loading={pending === tv.key}
                            onClick={() => {
                              start(tv, CastMode.Extend);
                            }}
                            size="xs"
                            variant="accent"
                          >
                            Extend
                          </Button>
                        }
                      />
                      <Tooltip
                        content="Pick a window or screen to show on the TV"
                        tone="overPhoto"
                        trigger={
                          <Button
                            disabled={pending !== undefined}
                            onClick={() => {
                              start(tv, CastMode.Pick);
                            }}
                            size="xs"
                          >
                            Show…
                          </Button>
                        }
                      />
                    </>
                  )
                }
                icon={<TelevisionSimpleIcon size={15} weight="bold" />}
                key={tv.key}
                label={tv.target.name}
                surface="filled"
              >
                {failed?.key === tv.key && (
                  <PanelNote tone="warning">{failed.why}</PanelNote>
                )}
              </ListRow>
            ))}
          </List>
        </PanelSection>
      )}
    </Panel>
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
      return "Used as another screen";
    case CastMode.Pick:
      return "Showing a window or screen";
  }
};

/** Its name and tooltip: what it casts to, if anything. */
const labelOf = (casts: readonly Running[]): string =>
  casts.length === 0
    ? "Cast to a TV"
    : `Casting to ${casts.map((cast) => cast.target.name).join(", ")}`;

// Not the library's `Button`: its ghost variant uses `muted` text, which is
// unreadable over the wallpaper. Matches the Bluetooth item.
const triggerStyles = css({
  _hoverOrOpen: { backgroundColor: "fillOverPhoto" },
  alignItems: "center",
  backgroundColor: "transparent",
  blockSize: 7,
  borderRadius: "lg",
  borderStyle: "none",
  color: "inherit",
  cursor: "pointer",
  display: "inline-flex",
  flexShrink: 0,
  inlineSize: 7,
  justifyContent: "center",
  padding: 0,
  transition: "background-color {durations.fast} {easings.default}",
});
