import { describe, expect, it } from "bun:test";
import type { Option, Result } from "@cprussin/option-result";
import { Err, None, Ok, Some } from "@cprussin/option-result";
import { sharedWatch } from "@domicile-desktop/react/shared-watch";
import type { SystemError } from "@domicile-desktop/sdk/system";
import { SystemErrorKind } from "@domicile-desktop/sdk/system";
import type { Network } from "@domicile-desktop/system-network/network";
import { Connectivity, Link } from "@domicile-desktop/system-network/network";

import { followPortals } from "./portal-sign-in";

type Checked = Result<Option<string>, SystemError>;

/** A network watch the test reports to. */
const heldNetwork = () => {
  const listeners: ((value: Result<Network, SystemError>) => void)[] = [];
  return {
    report: (link: Network["link"]) => {
      for (const onValue of listeners) {
        onValue(Ok({ connectivity: Connectivity.Unknown, link }));
      }
    },
    watch: sharedWatch(
      (onValue: (value: Result<Network, SystemError>) => void) => {
        listeners.push(onValue);
        return () => undefined;
      },
    ),
  };
};

/** A portal check that answers each of `answers` in turn, then the last. */
const checking = (...answers: Checked[]) => {
  const counted = { checks: 0 };
  return {
    check: () => {
      const answer = answers[Math.min(counted.checks, answers.length - 1)];
      counted.checks += 1;
      if (answer === undefined) {
        throw new Error("test: no answer to give");
      } else {
        return Promise.resolve(answer);
      }
    },
    get checks() {
      return counted.checks;
    },
  };
};

/** A wait the test ends by calling `elapse`. */
const heldWait = () => {
  const pending: { next: (() => void) | undefined } = { next: undefined };
  return {
    elapse: () => {
      const next = pending.next;
      pending.next = undefined;
      next?.();
    },
    get pending() {
      return pending.next !== undefined;
    },
    wait: (then: () => void) => {
      pending.next = then;
      return () => {
        pending.next = undefined;
      };
    },
  };
};

/** Lets the checks' promises settle. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

const NEVER = () => {
  throw new Error("test: nothing should be reported");
};

const PORTAL: Checked = Ok(Some("http://10.0.0.1/login"));
const OPEN: Checked = Ok(None());

/** Follows `network` with `answers`, recording what is shown. */
const follow = (...answers: Checked[]) => {
  const network = heldNetwork();
  const portal = checking(...answers);
  const timer = heldWait();
  const shown: (string | undefined)[] = [];
  const watch = followPortals({
    check: portal.check,
    network: network.watch,
    report: NEVER,
    show: (url) => {
      shown.push(url);
    },
    wait: timer.wait,
  });
  return { network, portal, shown, timer, watch };
};

describe("followPortals", () => {
  it("shows the sign-in page of a network with a portal", async () => {
    const { network, shown } = follow(PORTAL);
    network.report(Link.Wifi("Airport", 0.5));
    await settled();
    expect(shown).toStrictEqual(["http://10.0.0.1/login"]);
  });

  it("checks each network once, and none for no link", async () => {
    const { network, portal, shown, timer } = follow(OPEN);
    network.report(Link.None());
    network.report(Link.Wifi("Airport", 0.5));
    network.report(Link.Wifi("Airport", 0.7));
    await settled();
    network.report(Link.Wifi("Cafe", 0.7));
    await settled();
    expect(portal.checks).toBe(2);
    expect(timer.pending).toBe(false);
    expect(shown).toStrictEqual([]);
  });

  it("checks again on rejoining a network", async () => {
    const { network, portal } = follow(OPEN);
    network.report(Link.Wifi("Airport", 0.5));
    network.report(Link.None());
    network.report(Link.Wifi("Airport", 0.5));
    await settled();
    expect(portal.checks).toBe(2);
  });

  it("hides the sign-in page once signed in", async () => {
    const { network, portal, shown, timer } = follow(PORTAL, PORTAL, OPEN);
    network.report(Link.Wifi("Airport", 0.5));
    await settled();
    timer.elapse();
    await settled();
    timer.elapse();
    await settled();
    expect(portal.checks).toBe(3);
    expect(shown).toStrictEqual(["http://10.0.0.1/login", undefined]);
    expect(timer.pending).toBe(false);
  });

  it("hides the sign-in page on leaving the network", async () => {
    const { network, shown, timer } = follow(PORTAL);
    network.report(Link.Wifi("Airport", 0.5));
    await settled();
    network.report(Link.None());
    expect(shown).toStrictEqual(["http://10.0.0.1/login", undefined]);
    expect(timer.pending).toBe(false);
  });

  it("stops checking a network whose sign-in page was dismissed", async () => {
    const { network, portal, timer, watch } = follow(PORTAL);
    network.report(Link.Wifi("Airport", 0.5));
    await settled();
    watch.dismiss();
    expect(timer.pending).toBe(false);
    expect(portal.checks).toBe(1);
  });

  it("reports a check that failed", async () => {
    const network = heldNetwork();
    const failure: SystemError = {
      kind: SystemErrorKind.Other,
      message: "curl exited 6 asking for the portal probe",
    };
    const reported = new Promise((resolve) => {
      followPortals({
        check: checking(Err(failure)).check,
        network: network.watch,
        report: resolve,
        show: NEVER,
        wait: heldWait().wait,
      });
    });
    network.report(Link.Wired("Ethernet"));
    expect(await reported).toStrictEqual(failure);
  });
});
