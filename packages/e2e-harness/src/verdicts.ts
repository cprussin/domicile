// Whether an e2e script can tell its own failure from the compositor's.
//
// `exit 99` means "my own machinery failed, do not read this as a verdict on
// the code". A compositor that *died* is the opposite — the loudest possible
// verdict — so a script that bails with 99 without re-checking the compositor
// reports a crash as its own fault and the real failure is never seen.
//
// That mistake kept being made, usually while fixing the previous instance,
// so the check now lives inside the bail: `scripts/lib/harness.sh`'s
// `harness_fault` asks at the instant it fires. What is left for this module
// is that every script can reach that one copy and none of them goes around
// it — which is a spelling, and a spelling is the one thing a text scan can
// honestly police. It deliberately does not try to reason about which lines
// block; that approximation was an earlier version of this file and
// `timeout 20 wayland-info` walked straight through it.
//
// These rules are a backstop, not the guarantee. A shell can spell `exit 99`
// in ways no regex will see, and each version of this file has been defeated
// by the next spelling. What carries the weight is how the scripts that use
// the helpers are written: a diagnosis is one `if`/`elif`/`else` or one
// `case`, every arm of which ends in a helper that exits or in a pass, so no
// arm is reachable by dropping past another.
//
// Arms hold *within* one decision. A script is several in sequence, so each one
// after the first opens with `after N` — its own premise as its own first arm,
// because a later verdict about the compositor is only about the compositor if
// the earlier decisions held. And every decision that passes says so through
// `passed`, with `every_check_ran` at the end: a bail that no-ops leaves its
// decision undecided rather than convicting anyone, and the count is what
// turns the resulting silence into a failure instead of a green run.
//
// Every script that sources this file carries that whole property, with two
// exceptions. Naming the ones that *do* is what keeps going stale here — a
// count went first, then the roster that replaced it, each wrong the moment
// another script adopted the lib — so this names only the exceptions, and each
// of the two says the same thing in its own text above its source line.
//
// `e2e-chrome.sh` and `e2e-input.sh` source the helpers for the *bails* alone:
// they diagnose through `harness_fault` and convict through
// `compositor_verdict`, but their checks are sequential `if`s rather than arms
// of one decision, and they have no `passed` and no `every_check_ran`. So a
// bail that no-ops there falls through into the next check rather than being
// caught by a count, which is the thing the count exists for. Nothing does
// today — every arm in both ends in a helper that exits — but it is the
// difference between them and the rest, and worth naming rather than leaving
// to be discovered.
//
// Scripts that never source the file at all are reached by rule 1 and nothing
// else: rules 2 and 3 are vacuous for a script that names neither helper.
//
// Three rules, because each of the first two was found by a reviewer after the
// other was fixed, and each on its own goes green while the machinery is
// broken:
//
//   - no bare `exit 99`, which is the bypass itself;
//   - no local `harness_fault`, because a copy is a copy the test does not
//     drive, and the scan cannot tell a copy that re-checks from one that
//     does not;
//   - no `harness_fault` without the source line, because a script that lost
//     it does not fail loudly. `set -e` is off in these scripts, so the call
//     prints "command not found", the `if` body completes, and control falls
//     through into the verdict below — reporting a harness fault as a
//     compositor failure at `exit 1`. That is worse than the misattribution
//     this module exists to end.
//
// Every `.sh` in `scripts/`, not only the `e2e-*.sh` ones: `check.sh` runs the
// `test-*.sh` checks in the same loop and for the same stated reason, and
// `measure*.sh` and `probe-transparency.sh` drive the same harnesses. An
// earlier version globbed `e2e-*` and three scripts that would reach for
// `exit 99` were exempt without anyone deciding they should be.
//
// Nothing imports this outside its own test, and nothing should: it is a rule
// about the repo rather than a step in any run. That is why it is a module
// with tests rather than exports someone calls — `TESTING.md`'s "never widen
// exports for tests" is about a module that has other callers to widen for.
//
// Whether the bail *behaves* is a behaviour, so the test drives the real
// `scripts/lib/harness.sh` rather than reading it. `turbo.json` puts
// `scripts/**` in `test:unit`'s inputs, because a check on those files that
// does not re-run when they change is a check that has already failed once.

/**
 * The helpers that re-check the compositor before ending the script.
 *
 * Both of them, and that is the rule rather than an implementation detail: a
 * script whose only ending is `compositor_verdict` fails the same way as one
 * whose only ending is `harness_fault`, and keying the rules on one name left
 * the other outside all three.
 */
const BAILS = ["harness_fault", "compositor_verdict"] as const;

/**
 * Everything else a script gets from the helper file.
 *
 * Held to the copy and source rules but not to the `exit 99` one, which is
 * about bails. A local `every_check_ran() { :; }` is the same failure as a
 * local `harness_fault`: a copy the behaviour test does not drive, in the one
 * function whose whole job is to catch the others having gone quiet.
 */
const SOURCED = ["after", "passed", "every_check_ran"] as const;

/**
 * A script *calling* `name`, rather than a script containing the word.
 *
 * `harness_fault` is distinctive enough that a mention is worth flagging, but
 * `after` and `passed` are ordinary English and appear in the prose of a dozen
 * scripts that have nothing to do with this. So the rule reads command
 * position — the start of a line, or after any of the keywords and operators
 * that open one — and skips comment lines, which rule 1 already skips and
 * which are where the prose lives.
 *
 * Approximate in both directions, deliberately. A shell has more command
 * positions than a regex should chase, and this is a backstop: a call it
 * misses is caught by the script's own structure, since a script that reaches
 * one of these without sourcing the file fails at the first call rather than
 * running on.
 */
// `&&` and `||` but not a bare `&` or `|`: a lone pipe is almost always inside
// a quoted regex (`grep -E "before|after"`), and piping into a helper whose
// whole job is to `exit` would not reach the script anyway.
const OPENS = String.raw`^|[;(]|&&|\|\||\bif\b|\belif\b|\bthen\b|\belse\b|\bdo\b|\{|!`;
const calls = (name: string): RegExp =>
  new RegExp(`(${OPENS})[ \t]*${name}\\b`, "m");

/** The one file it may live in. */
const LIB = "scripts/lib/harness.sh";

/**
 * What a script exits with when its own machinery failed.
 *
 * Written as a person writes it, quoted or arithmetic included. A shell has
 * unboundedly many ways to say 99 — `rc=99; exit $rc` is two lines and this
 * will never see it — which is why the rules below do not carry the weight on
 * their own: see the header.
 */
const HARNESS_EXIT =
  /(^|;|\|\||&&|\s)exit\s+(["']?99["']?|\$\(\(\s*99\s*\)\))(\s|;|$)/;

/** A line that is only a comment, which cannot exit anything. */
const REMARK = /^\s*#/;

/**
 * A script spelling a helper out for itself, however bash lets it.
 *
 * Both keywords, both paren forms, and both body delimiters — `(` as well as
 * `{`. The subshell body is the one that matters most: it evades a `{`-only
 * rule *and* makes the `exit` inside it end the subshell rather than the
 * script, which is the no-op bail without needing anything unsourced.
 */
const defines = (bail: string): RegExp =>
  new RegExp(`^\\s*(function\\s+)?${bail}\\s*(\\(\\s*\\))?\\s*[{(]`, "m");

/**
 * A line that actually sources the helper, rather than naming it.
 *
 * `includes` was the rule until a reviewer commented the source line out and
 * the scan stayed green — and until this repo grew a `# shellcheck source=`
 * comment directly above one, which satisfies a substring test on its own and
 * is therefore a licence to delete the line below it.
 */
const SOURCES = /^\s*(\.|source)\s+\S*scripts\/lib\/harness\.sh/m;

/**
 * Everything wrong with how `script` reaches the bail, one line each.
 *
 * Empty means nothing is. The strings are what a failing test prints, so they
 * name the file's own line numbers where there is one to name.
 */
export const bailFaults = (script: string): string[] => {
  const bypasses = script
    .split("\n")
    .flatMap((line, index) =>
      HARNESS_EXIT.test(line) && !REMARK.test(line)
        ? [`${index + 1}: exits 99 without a helper from ${LIB}`]
        : [],
    );
  const shared = [...BAILS, ...SOURCED];
  const copies = shared
    .filter((name) => defines(name).test(script))
    .map((name) => `defines its own ${name}`);
  const code = script
    .split("\n")
    .filter((line) => !REMARK.test(line))
    .join("\n");
  const unreachable = shared
    .filter((name) => calls(name).test(code) && !SOURCES.test(script))
    .map((name) => `calls ${name} without sourcing ${LIB}`);
  return [...bypasses, ...copies, ...unreachable];
};
