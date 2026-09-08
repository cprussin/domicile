# @domicile/e2e-harness

A headless chrome stand-in for the `e2e-*.sh` scripts in `/scripts`, plus the
check on those scripts' own machinery. The real chrome is the engine loading a
shell's page ([`packages/domicile-engine`](../domicile-engine/README.md)); this
speaks the same protocol over the same socket without needing a display, so the
message plane can be verified in CI and on a headless box.

| Entry | Used by | What it does |
|---|---|---|
| `src/mock-chrome.ts` | `e2e-dmabuf.sh` | Connects, handshakes, and prints every message the host sends so the calling script can grep for one. |

`src/verdicts.ts` is the odd one out: not a harness but a check *on* the
scripts, run from `verdicts.test.ts` in the `typescript` group. `exit 99` in a
script means "my own machinery failed", and a compositor that crashed is the
opposite — so the scripts bail through `scripts/lib/harness.sh`, which asks
whether the compositor is still there at the instant it fires:
`harness_fault` for this suite's own fault, `compositor_verdict` for the
code's. Both exit, which is the point below.

What actually keeps the blame straight is structural: in the scripts
that use the helpers, a diagnosis is one `if`/`elif`/`else` or one `case`,
every arm of which ends in a helper that exits or in a pass — so no arm is
reachable by falling *through* another. A bail that turned into a no-op — the
helper unsourced, its name changed, its body a subshell — then no longer
*convicts the compositor* of this suite's fault, which is what happened twice.

Arms hold within one decision, and a script is several in sequence, so two more
things carry it. Each decision after the first opens with `after N` — its own
premise as its own first arm, since a later verdict about the compositor is
only about the compositor if the earlier decisions held. And a decision that
passes says so through `passed`, with `every_check_ran` as the script's last
line: a bail that no-ops leaves its decision undecided, and the count turns the
resulting silence into a failure rather than a green run. `every_check_ran`'s failure path is a
bare `exit 1` rather than a call to either verdict helper, since a count that
came out wrong is not a statement about the compositor. It is not otherwise
independent of the file it lives in: it reads `PASSED`, which only `passed`
sets, and a script that fails to source the file at all is caught by the third
rule below rather than by the count.

Five scripts of the twenty-five in `scripts/`, not all of them, source the
helpers; rules 2 and 3 below are vacuous for the other twenty, and rule 1 is
all that reaches them. Worth knowing before writing the next one.

Twenty-five because that is what the sweep reads — every `.sh` in the
directory, as the paragraph below says, not the sixteen `check.sh` runs.

That count is measured rather than remembered. It read "three scripts, not
sixteen … the other thirteen" until someone counted, and every number in it
was wrong — the helpers had spread past ten while the sentence went
on describing the three that first used them. It then said ten for a while,
which was true of the tree it was written against and stale by the next
rebase; a count in prose is only ever true of one commit.

`verdicts.ts` is the backstop rather than the guarantee, and says so: it drives
the real helpers and holds every `.sh` in `scripts/` to three rules — no
`exit 99` it can recognise, no local copy of anything the file
defines, and no call to any of it without a line that actually sources the
file. `after`, `passed` and `every_check_ran` are held to those two as well —
a local `every_check_ran() { :; }` is the same failure as a local
`harness_fault`, in the one function whose job is to notice the others having
gone quiet. Both verdict helpers, not one:
keying the rules on `harness_fault` alone left `compositor_verdict` outside
all three. A shell has unboundedly many ways to spell an exit status, and each
version of this file has been defeated by the next one; the rules catch what a
person writes, and the structure covers what they miss.

Every `.sh` rather than every `e2e-*.sh`, because `check.sh` runs the
`test-*.sh` checks in the same loop and the `measure*.sh` scripts drive these
same harnesses. `scripts/lib/harness.sh` is out of that sweep because reading
`scripts/` without recursing leaves it out — it is what the rules are about
rather than something they apply to. `test-client.sh` is down there with it,
sourced-only for the same reason.

Note that `exit 99` is not a verdict class the rest of the repo knows about:
`check.sh` counts every non-zero, non-77 status as failed, so 99 and 1 reach it
identically. The difference is the prose a human then reads — which is exactly
why the wrong one is expensive and nothing else catches it.

All of this exists because the same misattribution kept being shipped, and
each fix produced the next instance of it somewhere the last one had not been
looked at.

`src/desktop-line.ts` was the format a display probe printed, shared so the
`EXPECTED` strings in two scripts could not drift apart. It was kept after the
desktop assertions moved into `packages/domicile-compositor/tests/desktop.rs`,
on the expectation that the client-driven probes would grow back; they did not,
and its last caller went with `reload-displays-probe.ts`. Deleted rather than
kept for a caller that never arrived. `src/waiting.ts` went the same way: it
was `rest`, the sleep a probe with nothing to poll takes, and its callers
went with the scripts they served.

`src/chrome-socket.ts` is the shared connection: newline-delimited JSON framing
from [`@domicile/chrome-sdk/newline-frames`](../chrome-sdk/README.md), the
handshake, and decoding via the SDK's protocol schemas — so the harnesses drift
from the wire format only if the SDK does.

It reads the socket path from `DOMICILE_CHROME_SOCK`, and ends on its own —
on a timer, or when its sequence is done — since the script that spawns it runs
unattended.

## Usage

```sh
DOMICILE_CHROME_SOCK=/tmp/domicile-rt/domicile-chrome.sock \
  bun packages/e2e-harness/src/mock-chrome.ts
```

## Test

```sh
bun run --filter @domicile/e2e-harness test
```

The socket behaviour is covered by the e2e scripts themselves against a live
compositor, so what is tested here is the pure parts — plus `verdicts.test.ts`,
which is not pure: it spawns `bash` against `scripts/lib/harness.sh` and reads
`scripts/` off disk. It runs in `test:unit` anyway, and `turbo.json` names
`scripts/**` among that task's inputs so it re-runs when what it reads changes.
Splitting it out would give one file its own task for no gain; TESTING.md's
"keep integration tests in a dedicated folder" is noted and knowingly not
followed here.
