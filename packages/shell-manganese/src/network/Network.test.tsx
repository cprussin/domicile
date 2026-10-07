import { describe, expect, it } from "bun:test";
import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";
import type { SystemError } from "@domicile-desktop/sdk/system";
import { SystemErrorKind } from "@domicile-desktop/sdk/system";
import type { Network as Reading } from "@domicile-desktop/system-network/network";
import { Connectivity, Link } from "@domicile-desktop/system-network/network";
import { act, render, screen } from "@testing-library/react";

import { css } from "../../styled-system/css";
import { sharedWatch } from "../readouts/shared-watch";
import { Network } from "./Network";

/**
 * A test-controlled network: `network` replaces the library's watch, and
 * `report` sends what it would.
 */
const heldNetwork = () => {
  const listeners: ((network: Result<Reading, SystemError>) => void)[] = [];
  const watching = { stopped: 0 };
  return {
    network: sharedWatch(
      (onNetwork: (network: Result<Reading, SystemError>) => void) => {
        listeners.push(onNetwork);
        return () => {
          watching.stopped += 1;
        };
      },
    ),
    report: (network: Result<Reading, SystemError>) => {
      act(() => {
        for (const onNetwork of listeners) {
          onNetwork(network);
        }
      });
    },
    get stopped() {
      return watching.stopped;
    },
  };
};

const online = (link: Reading["link"]) =>
  Ok<Reading, SystemError>({ connectivity: Connectivity.Full, link });

describe("Network", () => {
  it("shows nothing until the network service has answered", () => {
    const network = heldNetwork();

    const { container } = render(<Network network={network.network} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("shows nothing without a network service", () => {
    const network = heldNetwork();
    const { container } = render(<Network network={network.network} />);

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
      render(<Network network={network.network} />);

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
      render(<Network network={network.network} />);

      network.report(online(Link.Wired("Wired connection 1")));

      expect(screen.getByRole("img", { name: "Wired" })).toBeVisible();
      expect(screen.queryByText("Wired connection 1")).not.toBeInTheDocument();
    });

    it("names any other link", () => {
      const network = heldNetwork();
      render(<Network network={network.network} />);

      network.report(online(Link.Other("wg0")));

      expect(screen.getByRole("img", { name: "Network" })).toBeVisible();
      expect(screen.getByText("wg0")).toBeVisible();
    });

    it("says when there is none", () => {
      const network = heldNetwork();
      render(<Network network={network.network} />);

      network.report(online(Link.None()));

      expect(screen.getByRole("img", { name: "Offline" })).toBeVisible();
    });
  });

  it("warns when the link does not reach the internet", () => {
    const network = heldNetwork();
    const { container } = render(<Network network={network.network} />);

    network.report(online(Link.Wifi("Cafe", 0.9)));
    expect(container.firstElementChild?.className).not.toContain(
      css({ color: "warning" }),
    );

    for (const connectivity of [Connectivity.Limited, Connectivity.Portal]) {
      network.report(Ok({ connectivity, link: Link.Wifi("Cafe", 0.9) }));
      expect(container.firstElementChild?.className).toContain(
        css({ color: "warning" }),
      );
    }
    expect(
      screen.getByRole("img", { name: "Wi-Fi, strong signal, no internet" }),
    ).toBeVisible();
  });

  it("stops watching when it goes away", () => {
    const network = heldNetwork();
    const { unmount } = render(<Network network={network.network} />);

    unmount();

    expect(network.stopped).toBe(1);
  });
});
