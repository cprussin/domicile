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

/** A wait the test ends by calling `elapse`, recording each wait's length. */
const heldWait = () => {
  const pending: { next: (() => void) | undefined } = { next: undefined };
  const waited: number[] = [];
  return {
    elapse: () => {
      const next = pending.next;
      pending.next = undefined;
      next?.();
    },
    get pending() {
      return pending.next !== undefined;
    },
    wait: (ms: number, then: () => void) => {
      waited.push(ms);
      pending.next = then;
      return () => {
        pending.next = undefined;
      };
    },
    waited,
  };
};

/** Lets the checks' promises settle. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

const NEVER = () => {
  throw new Error("test: nothing should be reported");
};

const PORTAL: Checked = Ok(Some("http://10.0.0.1/login"));
const OPEN: Checked = Ok(None());
const NO_ANSWER: Checked = Err({
  kind: SystemErrorKind.Other,
  message: "curl exited 28 asking for the portal probe",
});

/** Follows `network` with `answers`, recording what is shown and reported. */
const follow = (...answers: Checked[]) => {
  const network = heldNetwork();
  const portal = checking(...answers);
  const timer = heldWait();
  const shown: (string | undefined)[] = [];
  const reported: SystemError[] = [];
  const watch = followPortals({
    check: portal.check,
    network: network.watch,
    report: (error) => {
      reported.push(error);
    },
    show: (url) => {
      shown.push(url);
    },
    wait: timer.wait,
  });
  return { network, portal, reported, shown, timer, watch };
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

  it("keeps checking a network whose check got no answer", async () => {
    const { network, portal, shown, timer } = follow(
      NO_ANSWER,
      NO_ANSWER,
      PORTAL,
    );
    network.report(Link.Wifi("Airport", 0.5));
    await settled();
    timer.elapse();
    await settled();
    timer.elapse();
    await settled();
    expect(portal.checks).toBe(3);
    expect(shown).toStrictEqual(["http://10.0.0.1/login"]);
  });

  it("waits longer after each check with no answer, up to a minute", async () => {
    const { network, timer } = follow(NO_ANSWER);
    network.report(Link.Wifi("Airport", 0.5));
    for (let tries = 0; tries < 7; tries += 1) {
      await settled();
      timer.elapse();
    }
    expect(timer.waited).toStrictEqual([
      3000, 6000, 12_000, 24_000, 48_000, 60_000, 60_000,
    ]);
  });

  it("stops checking once a check finds the internet", async () => {
    const { network, portal, timer } = follow(NO_ANSWER, OPEN);
    network.report(Link.Wifi("Airport", 0.5));
    await settled();
    timer.elapse();
    await settled();
    expect(portal.checks).toBe(2);
    expect(timer.pending).toBe(false);
  });

  it("stops checking a network with no answer on leaving it", async () => {
    const { network, timer } = follow(NO_ANSWER);
    network.report(Link.Wifi("Airport", 0.5));
    await settled();
    network.report(Link.None());
    expect(timer.pending).toBe(false);
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
