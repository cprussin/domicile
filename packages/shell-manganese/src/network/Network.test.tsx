import { describe, expect, it } from "bun:test";
import type { Option, Result } from "@cprussin/option-result";
import { Err, None, Ok } from "@cprussin/option-result";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import type { SystemError } from "@domicile-desktop/sdk/system";
import { SystemErrorKind } from "@domicile-desktop/sdk/system";
import type { Network as Reading } from "@domicile-desktop/system-network/network";
import { Connectivity, Link } from "@domicile-desktop/system-network/network";
import type { Wifi } from "@domicile-desktop/system-network/wifi";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { css } from "../../styled-system/css";
import type { SharedWatch } from "../readouts/shared-watch";
import { sharedWatch } from "../readouts/shared-watch";
import { heldWifiActions } from "./held-wifi-actions";
import { Network } from "./Network";

/**
 * A test-controlled watch: `watch` replaces the library's, and `report` sends
 * what it would.
 */
const held = <T,>() => {
  const listeners: ((value: T) => void)[] = [];
  const watching = { started: 0, stopped: 0 };
  return {
    report: (value: T) => {
      act(() => {
        for (const onValue of listeners) {
          onValue(value);
        }
      });
    },
    get started() {
      return watching.started;
    },
    get stopped() {
      return watching.stopped;
    },
    watch: sharedWatch((onValue: (value: T) => void) => {
      watching.started += 1;
      listeners.push(onValue);
      return () => {
        watching.stopped += 1;
      };
    }),
  };
};

const heldNetwork = () => held<Result<Reading, SystemError>>();

/** A host the item never calls, since the library is injected. */
const NO_HOST = new FakeDomicileHost().host;

/** The item, with a Wi-Fi watch the test holds when given. */
const Item = ({
  network,
  wifi = held<Result<Option<Wifi>, SystemError>>().watch,
}: {
  network: SharedWatch<Result<Reading, SystemError>>;
  wifi?: SharedWatch<Result<Option<Wifi>, SystemError>>;
}) => (
  <Network
    actions={heldWifiActions().actions}
    domicile={NO_HOST}
    network={network}
    wifi={wifi}
  />
);

const online = (link: Reading["link"]) =>
  Ok<Reading, SystemError>({ connectivity: Connectivity.Full, link });

describe("Network", () => {
  it("shows nothing until the network service has answered", () => {
    const network = heldNetwork();

    const { container } = render(<Item network={network.watch} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("shows nothing without a network service", () => {
    const network = heldNetwork();
    const { container } = render(<Item network={network.watch} />);

    network.report(
      Err({
        kind: SystemErrorKind.Dbus,
        message: "org.freedesktop.DBus.Error.ServiceUnknown",
      }),
    );

    expect(container).toBeEmptyDOMElement();
  });

  describe("the link", () => {
    it("names a Wi-Fi network and grades its signal", () => {
      const network = heldNetwork();
      render(<Item network={network.watch} />);

      network.report(online(Link.Wifi("Home", 0.72)));
      expect(screen.getByText("Home")).toBeVisible();
      expect(
        screen.getByRole("img", { name: "Wi-Fi, strong signal" }),
      ).toBeVisible();

      network.report(online(Link.Wifi("Home", 0.5)));
      expect(
        screen.getByRole("img", { name: "Wi-Fi, fair signal" }),
      ).toBeVisible();

      network.report(online(Link.Wifi("Home", 0.2)));
      expect(
        screen.getByRole("img", { name: "Wi-Fi, weak signal" }),
      ).toBeVisible();
    });

    it("marks a wired link", () => {
      const network = heldNetwork();
      render(<Item network={network.watch} />);

      network.report(online(Link.Wired("Wired connection 1")));

      expect(screen.getByRole("img", { name: "Wired" })).toBeVisible();
      expect(screen.queryByText("Wired connection 1")).not.toBeInTheDocument();
    });

    it("names any other link", () => {
      const network = heldNetwork();
      render(<Item network={network.watch} />);

      network.report(online(Link.Other("wg0")));

      expect(screen.getByRole("img", { name: "Network" })).toBeVisible();
      expect(screen.getByText("wg0")).toBeVisible();
    });

    it("says when there is none", () => {
      const network = heldNetwork();
      render(<Item network={network.watch} />);

      network.report(online(Link.None()));

      expect(screen.getByRole("img", { name: "Offline" })).toBeVisible();
    });
  });

  it("warns when the link does not reach the internet", () => {
    const network = heldNetwork();
    render(<Item network={network.watch} />);

    network.report(online(Link.Wifi("Cafe", 0.9)));
    expect(screen.getByRole("button").className).not.toContain(
      css({ color: "warning" }),
    );

    for (const connectivity of [Connectivity.Limited, Connectivity.Portal]) {
      network.report(Ok({ connectivity, link: Link.Wifi("Cafe", 0.9) }));
      expect(screen.getByRole("button").className).toContain(
        css({ color: "warning" }),
      );
    }
    expect(
      screen.getByRole("img", { name: "Wi-Fi, strong signal, no internet" }),
    ).toBeVisible();
  });

  it("stops watching when it goes away", () => {
    const network = heldNetwork();
    const { unmount } = render(<Item network={network.watch} />);

    unmount();

    expect(network.stopped).toBe(1);
  });

  describe("its panel", () => {
    it("opens on a click, and reads Wi-Fi only while open", async () => {
      const network = heldNetwork();
      const wifi = held<Result<Option<Wifi>, SystemError>>();
      render(<Item network={network.watch} wifi={wifi.watch} />);
      network.report(online(Link.Wifi("Home", 0.72)));
      expect(wifi.started).toBe(0);

      await userEvent.click(
        screen.getByRole("button", { name: "Wi-Fi, strong signal Home" }),
      );
      wifi.report(Ok(None()));

      expect(screen.getByText("No Wi-Fi device")).toBeVisible();
      expect(wifi.started).toBe(1);

      await userEvent.keyboard("{Escape}");

      expect(wifi.stopped).toBe(1);
    });
  });
});
