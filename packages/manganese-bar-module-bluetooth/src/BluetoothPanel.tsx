import { Result } from "@cprussin/option-result";
import { Button } from "@domicile-desktop/component-library/Button";
import { EmptyState } from "@domicile-desktop/component-library/EmptyState";
import { IconButton } from "@domicile-desktop/component-library/IconButton";
import { List, ListRow } from "@domicile-desktop/component-library/ListRow";
import { Loading } from "@domicile-desktop/component-library/Loading";
import { PanelAction } from "@domicile-desktop/component-library/Panel";
import { PanelNote } from "@domicile-desktop/component-library/PanelNote";
import { PanelSection } from "@domicile-desktop/component-library/PanelSection";
import { Switch } from "@domicile-desktop/component-library/Switch";
import { Tooltip } from "@domicile-desktop/component-library/Tooltip";
import { useRequests } from "@domicile-desktop/manganese-host/useRequests";
import type { Domicile } from "@domicile-desktop/sdk/desktop/desktop";
import type { SystemError } from "@domicile-desktop/sdk/system";
import type {
  Bluetooth,
  Device,
} from "@domicile-desktop/system-bluetooth/bluetooth";
import { BluetoothIcon } from "@phosphor-icons/react/dist/ssr/Bluetooth";
import { BluetoothSlashIcon } from "@phosphor-icons/react/dist/ssr/BluetoothSlash";
import { XIcon } from "@phosphor-icons/react/dist/ssr/X";
import type { ReactNode } from "react";
import { useEffect } from "react";
import type { BluetoothActions } from "./bluetooth-actions";

type Props = {
  bluetooth: Bluetooth;
  /** Where requests go. */
  host: Domicile;
  actions: BluetoothActions;
};

/**
 * The Bluetooth panel: a switch for every adapter in the header, and the
 * devices BlueZ knows, grouped as connected, paired and nearby, each with
 * what can be done with it.
 *
 * Scans while shown, so new devices appear. A refusal shows plainly where it
 * was asked, with BlueZ's words in its tooltip; BlueZ's state shows the rest.
 */
export const BluetoothPanel = ({ actions, bluetooth, host }: Props) => {
  const requests = useRequests();
  const powered = bluetooth.adapters.filter((adapter) => adapter.powered);
  const on = powered.length > 0;
  const searching = bluetooth.adapters.some(({ discovering }) => discovering);
  const sorted = bluetooth.devices.toSorted(byName);
  const nearby = sorted.filter((device) => !device.paired);
  const groups = [
    ["Connected", sorted.filter((device) => device.connected)],
    ["Paired", sorted.filter((device) => device.paired && !device.connected)],
    ["Nearby", nearby],
  ] as const;
  return (
    <>
      <PanelAction>
        <Switch
          checked={on}
          hideLabel
          label="Bluetooth"
          onCheckedChange={(checked) => {
            requests.run("power", async () => {
              const results = await Promise.all(
                bluetooth.adapters.map(({ path }) =>
                  actions.setPowered(host, path, checked),
                ),
              );
              return Result.collect(results);
            });
          }}
        />
      </PanelAction>
      <Failure error={requests.failed("power")}>
        {on ? "Couldn't turn Bluetooth off" : "Couldn't turn Bluetooth on"}
      </Failure>
      {on ? (
        <>
          {powered.map(({ path }) => (
            <Discovery
              actions={actions}
              adapter={path}
              host={host}
              key={path}
            />
          ))}
          {groups.map(
            ([label, devices]) =>
              devices.length > 0 && (
                <PanelSection
                  action={
                    label === "Nearby" &&
                    searching && (
                      <Loading layout="glyph">Looking for devices…</Loading>
                    )
                  }
                  key={label}
                  label={label}
                >
                  <List>
                    {devices.map((device) => (
                      <DeviceRow
                        device={device}
                        failed={failedOf(requests, device)}
                        key={device.path}
                        onAsk={(verb, request) => {
                          requests.run(keyOf(verb, device), () =>
                            request(host, actions),
                          );
                        }}
                        pending={VERBS.some((verb) =>
                          requests.pending(keyOf(verb, device)),
                        )}
                      />
                    ))}
                  </List>
                </PanelSection>
              ),
          )}
          {searching && nearby.length === 0 && (
            <PanelSection label="Nearby">
              <Loading icon={BluetoothIcon}>Looking for devices…</Loading>
            </PanelSection>
          )}
          {sorted.length === 0 && !searching && (
            <EmptyState
              hint="Put your device in pairing mode to see it here."
              icon={BluetoothIcon}
              title="No devices nearby"
            />
          )}
        </>
      ) : (
        <EmptyState
          hint="Turn it on to connect headphones, keyboards and more."
          icon={BluetoothSlashIcon}
          title="Bluetooth is off"
        />
      )}
    </>
  );
};

/** What a row asks BlueZ to do. */
type Verb = "connect" | "disconnect" | "pair" | "forget";

const VERBS: readonly Verb[] = ["connect", "disconnect", "pair", "forget"];

/** Each request's key: what it does, to which device. */
const keyOf = (verb: Verb, device: Device): string => `${verb}:${device.path}`;

/** The device's refused request, if any, and what it was. */
const failedOf = (
  requests: ReturnType<typeof useRequests>,
  device: Device,
): { verb: Verb; error: SystemError } | undefined =>
  VERBS.flatMap((verb) => {
    const error = requests.failed(keyOf(verb, device));
    return error === undefined ? [] : [{ error, verb }];
  })[0];

/** Scans on `adapter` while shown. */
const Discovery = ({
  actions,
  adapter,
  host,
}: {
  actions: BluetoothActions;
  adapter: string;
  host: Domicile;
}) => {
  useEffect(() => {
    report("start scanning", actions.startDiscovery(host, adapter));
    return () => {
      report("stop scanning", actions.stopDiscovery(host, adapter));
    };
  }, [actions, adapter, host]);
  return undefined;
};

/** A request a row makes, given where it goes. */
type Request = (
  host: Domicile,
  actions: BluetoothActions,
) => ReturnType<BluetoothActions["connect"]>;

type DeviceRowProps = {
  device: Device;
  failed: { verb: Verb; error: SystemError } | undefined;
  pending: boolean;
  onAsk: (verb: Verb, request: Request) => void;
};

const DeviceRow = ({ device, failed, onAsk, pending }: DeviceRowProps) => (
  <ListRow
    detail={detailOf(device)}
    end={
      <>
        <Button
          loading={pending}
          onClick={() => {
            onAsk(primaryVerb(device), primaryRequest(device));
          }}
          size="xs"
          variant={device.connected ? "primary" : "accent"}
        >
          {primaryLabel(device)}
        </Button>
        {device.paired && (
          <Tooltip
            content="Forget"
            tone="overPhoto"
            trigger={
              <IconButton
                label={`Forget ${device.name}`}
                onClick={() => {
                  onAsk("forget", (host, actions) =>
                    actions.forget(host, device),
                  );
                }}
                size="sm"
              >
                <XIcon aria-hidden size={12} weight="bold" />
              </IconButton>
            }
          />
        )}
      </>
    }
    icon={<BluetoothIcon size={15} weight="bold" />}
    label={device.name}
    surface="filled"
  >
    {failed !== undefined && (
      <Failure error={failed.error}>{FAILED[failed.verb]}</Failure>
    )}
  </ListRow>
);

/** What a refusal says, by what was asked. */
const FAILED: Record<Verb, string> = {
  connect: "Couldn't connect",
  disconnect: "Couldn't disconnect",
  forget: "Couldn't forget it",
  pair: "Couldn't pair",
};

/** What failed, in plain words, with BlueZ's in its tooltip. */
const Failure = ({
  children,
  error,
}: {
  children: ReactNode;
  error: SystemError | undefined;
}) =>
  error !== undefined && (
    <PanelNote detail={error.message} tone="warning">
      {children}
    </PanelNote>
  );

const primaryVerb = (device: Device): Verb => {
  if (device.connected) {
    return "disconnect";
  } else if (device.paired) {
    return "connect";
  } else {
    return "pair";
  }
};

/** Disconnect a connected device, connect a paired one, or pair a new one. */
const primaryRequest = (device: Device): Request => {
  if (device.connected) {
    return (host, actions) => actions.disconnect(host, device.path);
  } else if (device.paired) {
    return (host, actions) => actions.connect(host, device.path);
  } else {
    return async (host, actions) =>
      (await actions.pair(host, device.path)).andThenAsync(() =>
        actions.connect(host, device.path),
      );
  }
};

const primaryLabel = (device: Device): string => {
  if (device.connected) {
    return "Disconnect";
  } else if (device.paired) {
    return "Connect";
  } else {
    return "Pair";
  }
};

/**
 * Its second line: the battery while connected, else whether it is paired.
 * A nearby device shows its address, which tells apart devices that share a
 * name.
 */
const detailOf = (device: Device): string => {
  if (device.connected) {
    return device.battery === undefined
      ? "Connected"
      : `Battery ${device.battery.toString()}%`;
  } else if (device.paired) {
    return "Not connected";
  } else {
    return device.address;
  }
};

const byName = (a: Device, b: Device): number => a.name.localeCompare(b.name);

/** Sends a request whose outcome nothing shows, logging a failure. */
const report = (
  what: string,
  asking: ReturnType<BluetoothActions["startDiscovery"]>,
): void => {
  asking.then(
    (result) => {
      result.match({
        Err: (error) => {
          // biome-ignore lint/suspicious/noConsole: nothing in the panel shows it
          console.error(`BlueZ refused to ${what}`, error);
        },
        Ok: () => undefined,
      });
    },
    (error: unknown) => {
      // biome-ignore lint/suspicious/noConsole: surfacing a background failure
      console.error(`Failed to ${what}`, error);
    },
  );
};
