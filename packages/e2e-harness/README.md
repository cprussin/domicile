# @domicile/e2e-harness

A headless chrome stand-in for the `e2e-*.sh` scripts in `/scripts`, plus the
check on those scripts' own machinery. The real chrome is the engine loading a
shell's page ([`packages/domicile-engine`](../domicile-engine/README.md)); this
speaks the same protocol over the same socket without needing a display, so the
message plane can be verified in CI and on a headless box.

| Entry | Used by | What it does |
|---|---|---|
| `src/mock-chrome.ts` | `e2e-dmabuf.sh` | Connects, handshakes, and prints every message the host sends so the calling script can grep for one. |

Two modules here are not harnesses but checks *on* the scripts, run from
their own tests in the `typescript` group:

| Module | What it holds `scripts/*.sh` to |
|---|---|
| `src/verdicts.ts` | that a script cannot tell its own failure from the compositor's by going around `scripts/lib/harness.sh`. The three rules are below |
| `src/skips.ts` | that a script which exits 77 printed a reason in the one shape `check.sh` reads — `SKIP: …` opening the printed string. Without it a skip reports `skipped ()`, and under `DOMICILE_CHECK_STRICT=1` fails with an empty reason |

`exit 99` in a script means "my own machinery failed", and a compositor that
crashed is the opposite — so the scripts bail through
`scripts/lib/harness.sh`, which asks whether the compositor is still there at
the instant it fires: `harness_fault` for this suite's own fault,
`compositor_verdict` for the code's. Both exit, which is the point below.

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

Most scripts in `scripts/` do not source the helpers at all, and rules 2 and
3 below are vacuous for those — rule 1 is all that reaches them. Worth knowing
before writing the next one.

**No count is written down here, and that is deliberate.** This paragraph
carried one through several rewrites and every figure in it was wrong by the
time anybody checked: three scripts of sixteen, then ten, then five of
twenty-five, each true of the tree it was written against and stale by the
next rebase. `verdicts.ts`'s own header stopped naming a roster for the same
reason. `grep -l lib/harness.sh scripts/*.sh` is the answer, and
`ls scripts/*.sh | wc -l` is the denominator.

`verdicts.ts` is the backstop rather than the guarantee, and says so: it drives
the real helpers and holds every `.sh` in `scripts/` to three rules — no
`exit 99` it can recognize, no local copy of anything the file
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
`test-*.sh` checks in the same loop and for the same stated reason, and
because an earlier version that globbed `e2e-*` left three scripts that would
reach for `exit 99` exempt without anyone deciding they should be.
`scripts/lib/harness.sh` is out of that sweep because reading `scripts/`
without recursing leaves it out — it is what the rules are about rather than
something they apply to. `test-client.sh` is down there with it, sourced-only
for the same reason.

Note that `exit 99` is not a verdict class the rest of the repo knows about:
`check.sh` counts every non-zero, non-77 status as failed, so 99 and 1 reach it
identically. The difference is the prose a human then reads — which is exactly
why the wrong one is expensive and nothing else catches it.

All of this exists because the same misattribution kept being shipped, and
each fix produced the next instance of it somewhere the last one had not been
looked at.

Nothing here is kept for a caller that has not arrived. Two shared modules
were, on the expectation that the probes they served would grow back, and both
were eventually deleted unused; a module whose last caller went should go with
it.

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
bun run turbo test --filter @domicile/e2e-harness
```

The socket behavior is covered by the e2e scripts themselves against a live
compositor, so what is tested here is the pure parts — plus `verdicts.test.ts`
and `skips.test.ts`, which are not pure: both read `scripts/` off disk and the
first also spawns `bash` against `scripts/lib/harness.sh`. They run in
`test:unit` anyway, and `turbo.json` names `scripts/**` among that task's
inputs so they re-run when what they read changes.
Splitting it out would give one file its own task for no gain; TESTING.md's
"keep integration tests in a dedicated folder" is noted and knowingly not
followed here.
