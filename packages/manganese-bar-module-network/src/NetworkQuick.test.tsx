import { describe, expect, it } from "bun:test";
import type { Option, Result } from "@cprussin/option-result";
import { Err, None, Ok, Some } from "@cprussin/option-result";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import type { SystemError } from "@domicile-desktop/sdk/system";
import { SystemErrorKind } from "@domicile-desktop/sdk/system";
import type { NetworkInterface } from "@domicile-desktop/system-network/interfaces";
import { InterfaceKind } from "@domicile-desktop/system-network/interfaces";
import type { Network as Reading } from "@domicile-desktop/system-network/network";
import { Connectivity, Link } from "@domicile-desktop/system-network/network";
import type { Wifi } from "@domicile-desktop/system-network/wifi";
import { WifiBackend } from "@domicile-desktop/system-network/wifi";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { held } from "./held-watch";
import { heldWifiActions } from "./held-wifi-actions";
import { NetworkGlyph, NetworkTiles } from "./NetworkQuick";

/** A host the tiles never call, since the library is injected. */
const NO_HOST = new FakeDomicileHost().domicile;

const CABLE: NetworkInterface = {
  hardwareAddress: "8c:16:45:5a:3e:01",
  kind: InterfaceKind.Wired,
  name: "enp0s31f6",
  speed: 1000,
  up: true,
};

const RADIO: NetworkInterface = {
  hardwareAddress: "a4:c3:f0:85:ac:2d",
  kind: InterfaceKind.Wireless,
  name: "wlan0",
  speed: undefined,
  up: true,
};

const WIFI: Wifi = {
  backend: WifiBackend.NetworkManager,
  connection: {
    bitrate: 866.7,
    frequency: 5180,
    ip: undefined,
    ssid: "Home",
    strength: 0.72,
  },
  device: "/org/freedesktop/NetworkManager/Devices/3",
  enabled: true,
  hardwareAddress: "A4:C3:F0:85:AC:2D",
  interface: "wlan0",
  networks: [],
  scanning: false,
};

const online = (link: Reading["link"]) =>
  Ok<Reading, SystemError>({ connectivity: Connectivity.Full, link });

/** The tiles, with each watch held by the test. */
const tiles = (
  onMore?: () => void,
  actions: ReturnType<typeof heldWifiActions> = heldWifiActions(),
) => {
  const interfaces = held<Result<NetworkInterface[], SystemError>>();
  const wifi = held<Result<Option<Wifi>, SystemError>>();
  render(
    <NetworkTiles
      actions={actions.actions}
      domicile={NO_HOST}
      interfaces={interfaces.watch}
      onMore={onMore}
      wifi={wifi.watch}
    />,
  );
  return { actions, interfaces, wifi };
};

describe(NetworkGlyph, () => {
  it("shows nothing until the network service has answered", () => {
    const { container } = render(
      <NetworkGlyph
        interfaces={held<Result<NetworkInterface[], SystemError>>().watch}
        network={held<Result<Reading, SystemError>>().watch}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("names the Wi-Fi network, or the cable", () => {
    const network = held<Result<Reading, SystemError>>();
    const interfaces = held<Result<NetworkInterface[], SystemError>>();
    render(
      <NetworkGlyph interfaces={interfaces.watch} network={network.watch} />,
    );
    interfaces.report(Ok([RADIO]));
    network.report(online(Link.Wifi("Home", 0.9)));
    expect(
      screen.getByRole("img", { name: "Wi-Fi, strong signal: Home" }),
    ).toBeVisible();

    interfaces.report(Ok([CABLE]));
    network.report(online(Link.Wired("Wired connection 1")));

    expect(screen.getByRole("img", { name: "Wired" })).toBeVisible();
  });
});

describe(NetworkTiles, () => {
  it("shows nothing until Wi-Fi has been read", () => {
    const { interfaces } = tiles();
    interfaces.report(Ok([RADIO]));
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("names the Wi-Fi network, and turns the radio off", async () => {
    const { actions, interfaces, wifi } = tiles();
    interfaces.report(Ok([RADIO]));
    wifi.report(Ok(Some(WIFI)));
    expect(screen.getByText("Home")).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "Wi-Fi" }));

    expect(actions.asked).toEqual([["setEnabled", WIFI.device, false]]);
  });

  it("says plainly when the radio could not be switched", async () => {
    const { interfaces, wifi } = tiles(
      undefined,
      heldWifiActions(() =>
        Err({
          kind: SystemErrorKind.Dbus,
          message: "net.connman.iwd.Failed: Operation failed",
        }),
      ),
    );
    interfaces.report(Ok([RADIO]));
    wifi.report(Ok(Some(WIFI)));

    await userEvent.click(screen.getByRole("button", { name: "Wi-Fi" }));

    expect(await screen.findByText("Couldn't switch")).toBeVisible();
    expect(screen.queryByText(/iwd/)).toBeNull();
  });

  it("shows a wired tile with a cable in, which opens the details", async () => {
    const opened = Promise.withResolvers<true>();
    const { interfaces, wifi } = tiles(() => {
      opened.resolve(true);
    });
    interfaces.report(Ok([CABLE]));
    wifi.report(Ok(None()));

    expect(screen.queryByRole("button", { name: "Wi-Fi" })).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: "Wired details" }),
    );

    expect(screen.getByText("Connected, 1 Gb/s")).toBeVisible();
    expect(await opened.promise).toBe(true);
  });

  it("shows both with a cable in beside Wi-Fi", () => {
    const { interfaces, wifi } = tiles(() => undefined);
    interfaces.report(Ok([CABLE, RADIO]));
    wifi.report(Ok(Some({ ...WIFI, connection: undefined, enabled: false })));

    expect(screen.getByRole("button", { name: "Wi-Fi" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByText("Off")).toBeVisible();
    expect(screen.getByRole("button", { name: "Wired details" })).toBeVisible();
  });
});
