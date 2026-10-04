# Script verdicts

How `scripts/*.sh` report failures, and what `src/verdicts.ts` checks.

## Exit codes

- `0`: pass.
- `77`: skip. The script must print `SKIP: <reason>` (checked by `src/skips.ts`).
- `99`: the script's own machinery failed.
- Any other non-zero: the code under test failed.

`check.sh` treats 99 and 1 the same. Only the printed message tells them
apart, so a compositor crash reported as a harness fault hides the real
failure.

## Helpers in `scripts/lib/harness.sh`

- `harness_fault <pid> <what it was doing> <line>...`: bail for the script's
  own fault. Checks first whether the compositor is still alive, and reports a
  dead compositor as a compositor failure.
- `compositor_verdict <pid> <line>...`: fail the compositor.
- `after N`: first arm of every decision after the first. Returns non-zero
  unless exactly `N` decisions have passed. Does not exit.
- `passed`: record that a decision passed.
- `every_check_ran N`: last line of the script. Exits 1 unless exactly `N`
  decisions passed.

Both verdict helpers exit. They only work when called directly: in a pipeline
or command substitution, `exit` ends the subshell and the script continues.

## Script structure

- Each decision is one `if`/`elif`/`else` or one `case`.
- Every arm ends in a helper that exits, or in `passed`.
- If a helper silently does nothing (unsourced, renamed, run in a subshell),
  `every_check_ran` catches the missing pass.

```sh
if ! after 1; then
  harness_fault "$COMP" "checking the second window" "ERROR: first check did not pass"
elif <check>; then
  passed "second window mapped"
else
  compositor_verdict "$COMP" "FAIL: second window never mapped"
fi
```

Most scripts don't source the helpers. To list the ones that do:

```sh
grep -l lib/harness.sh scripts/*.sh
```

## Rules in `src/verdicts.ts`

Applied to every `.sh` directly in `scripts/` (not `scripts/lib/`):

1. No bare `exit 99`.
2. No local definition of any helper above.
3. No call to a helper without a line that sources `scripts/lib/harness.sh`.

Rules 2 and 3 only apply to scripts that use the helpers. The rules catch
common mistakes. They can't catch every one, so follow the script structure.
