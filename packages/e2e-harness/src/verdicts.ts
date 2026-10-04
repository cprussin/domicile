// Checks that every script in `scripts/` bails through the shared helpers in
// `scripts/lib/harness.sh`.
//
// `exit 99` means the script's own machinery failed. If the compositor died,
// that is a real failure, so `harness_fault` re-checks the compositor before
// it exits 99. This module checks that scripts use that helper and do not go
// around it. Rules:
//
//   - no bare `exit 99`;
//   - no local copy of a helper, because the behavior test does not cover a
//     copy;
//   - no helper call without the source line. `set -e` is off, so a missing
//     helper prints "command not found" and control falls through to the
//     verdict, which then blames the compositor.
//
// A text scan cannot see every way a shell spells `exit 99`, so this is a
// backstop. The main guard is how scripts are written:
//
//   - each decision is one `if`/`elif`/`else` or `case`, and every arm exits
//     or passes;
//   - each later decision opens with `after N`, so it blames the compositor
//     only if the earlier checks passed;
//   - each pass goes through `passed`, and `every_check_ran` at the end fails
//     a run where a bail did nothing.
//
// The test also runs the real `harness.sh`, since a text scan cannot tell
// whether the bail re-checks the compositor. `turbo.json` lists `scripts/**`
// as an input to `test:unit` so that script changes re-run it.

/**
 * The helpers that re-check the compositor before ending the script.
 *
 * Both need every rule: bypassing either one hides a compositor crash.
 */
const BAILS = ["harness_fault", "compositor_verdict"] as const;

/**
 * The other helpers a script gets from the helper file.
 *
 * Held to the copy and source rules, but not the `exit 99` rule.
 */
const SOURCED = ["after", "passed", "every_check_ran"] as const;

/**
 * A script calling `name`, not merely containing the word.
 *
 * `after` and `passed` are common English words, so this matches only command
 * position. The match is approximate; see the module comment.
 */
// Excludes a bare `|`: it is usually inside a quoted regex, and a piped helper
// could not exit the script anyway.
const OPENS = String.raw`^|[;(]|&&|\|\||\bif\b|\belif\b|\bthen\b|\belse\b|\bdo\b|\{|!`;
const calls = (name: string): RegExp =>
  new RegExp(`(${OPENS})[ \t]*${name}\\b`, "m");

/** The only file the helpers may be defined in. */
const LIB = "scripts/lib/harness.sh";

/**
 * What a script exits with when its own machinery failed.
 *
 * Matches the plain, quoted and arithmetic forms. Indirect forms such as
 * `rc=99; exit $rc` are not detected.
 */
const HARNESS_EXIT =
  /(^|;|\|\||&&|\s)exit\s+(["']?99["']?|\$\(\(\s*99\s*\)\))(\s|;|$)/;

/** A line that is only a comment, which cannot exit anything. */
const REMARK = /^\s*#/;

/**
 * A script defining its own copy of a helper, in any bash function syntax.
 *
 * Includes the `( … )` body: its `exit` ends only the subshell, so the bail
 * does nothing.
 */
const defines = (bail: string): RegExp =>
  new RegExp(`^\\s*(function\\s+)?${bail}\\s*(\\(\\s*\\))?\\s*[{(]`, "m");

/**
 * A line that sources the helper file, not one that only names it.
 *
 * A substring test would accept a commented-out source line or the
 * `# shellcheck source=` directive.
 */
const SOURCES = /^\s*(\.|source)\s+\S*scripts\/lib\/harness\.sh/m;

/** Every way `script` misuses the helpers, with line numbers where known. */
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
